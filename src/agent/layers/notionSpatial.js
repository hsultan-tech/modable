/*
 * Notion Spatial Mode — a Modable layer for the Notion desktop app.
 *
 * Turns the current page into a pannable, zoomable canvas of cards, one per
 * section, and puts it back without touching the document. Everything here is
 * a presentation layer over the live page: it reads blocks once on entry,
 * never writes to them, and the only native node it changes is the page
 * scroller's inline style, which is saved and restored verbatim.
 *
 * Anchors, all read from the live 7.x DOM rather than hashed class names:
 *   .notion-frame                         the page viewport (canvas covers it)
 *   .notion-scroller                      what softens on entry
 *   .notion-page-content > [data-block-id] top-level blocks
 *   notion-{type}-block                   block type (header / sub_header / …)
 *   [data-content-editable-leaf]          a block's own text
 *   .notion-topbar-action-buttons [aria-label="Share"]  where the toggle sits
 *
 * Only the toggle and the stylesheet are claimed marks, because they are the
 * only nodes that exist straight after injection. Everything else is tagged
 * through mark() so it is not mistaken for proof the layer took.
 */
(function () {
  var KEY = 'notion-spatial';
  var ATTR = 'data-modable';
  var hooks = (window.__modableTeardown = window.__modableTeardown || {});

  // Injecting twice replaces the first copy rather than stacking a second.
  if (hooks[KEY]) { try { hooks[KEY](); } catch (e) {} }
  document.querySelectorAll('[data-modable^="notion-spatial"]').forEach(function (n) { n.remove(); });

  var topbarButtons = document.querySelector('.notion-topbar-action-buttons');
  if (!document.querySelector('.notion-frame') || !topbarButtons) {
    return { ok: false, reason: 'Notion page frame or topbar not found' };
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cleanups = [];
  var state = null; // non-null while Spatial Mode is open

  function mark(el, part) { el.setAttribute(ATTR, KEY + '-' + part); return el; }
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------------------------------------------------------- style */

  var style = document.createElement('style');
  style.setAttribute('data-modable', 'notion-spatial-style');
  style.textContent = [
    '.mns-toggle{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border-radius:6px;',
    ' font-size:14px;line-height:1;color:var(--c-texPri,inherit);cursor:pointer;user-select:none;white-space:nowrap;transition:background .12s,color .12s}',
    '.mns-toggle:hover{background:var(--ca-bacIntTra,rgba(128,128,128,.12))}',
    '.mns-toggle svg{width:15px;height:15px;flex:none;opacity:.8}',
    '.mns-toggle.mns-on{color:var(--mns-accent)}',
    '.mns-toggle.mns-on svg{opacity:1}',

    '.mns-canvas{position:fixed;z-index:90;overflow:hidden;outline:none;cursor:default;background-color:var(--mns-bg);',
    ' background-image:radial-gradient(var(--mns-dot) 1px,transparent 1.3px);touch-action:none;',
    ' font-family:ui-sans-serif,-apple-system,"system-ui","Segoe UI",Helvetica,Arial,sans-serif;color:var(--mns-fg);',
    ' -webkit-font-smoothing:antialiased;opacity:0;transition:opacity .3s ease}',
    '.mns-canvas.mns-in{opacity:1}',
    '.mns-canvas.mns-panning{cursor:grabbing}',
    '.mns-world{position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;will-change:transform}',
    '.mns-edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}',
    '.mns-edge{fill:none;stroke:var(--mns-edge);stroke-width:1.4;vector-effect:non-scaling-stroke;transition:stroke .12s}',
    '.mns-edge-hit{fill:none;stroke:transparent;stroke-width:14;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:pointer}',
    '.mns-edge-g:hover .mns-edge{stroke:var(--mns-edge-hi)}',
    '.mns-edge-g.mns-sel .mns-edge{stroke:var(--mns-accent);stroke-width:1.8}',
    '.mns-edge-end{fill:var(--mns-edge)}',
    '.mns-edge-g.mns-sel .mns-edge-end{fill:var(--mns-accent)}',
    '.mns-edge-temp{fill:none;stroke:var(--mns-accent);stroke-width:1.4;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}',

    '.mns-card{position:absolute;left:0;top:0;width:300px;box-sizing:border-box;padding:14px 16px 14px;border-radius:10px;',
    ' background:var(--mns-card);border:1px solid var(--mns-line);box-shadow:var(--mns-shadow);cursor:grab;user-select:none;',
    ' transition:box-shadow .15s,border-color .15s}',
    '.mns-card:hover{border-color:var(--mns-line-hi)}',
    '.mns-card.mns-dragging{cursor:grabbing;box-shadow:var(--mns-shadow-lift)}',
    '.mns-card.mns-sel{border-color:var(--mns-accent);box-shadow:0 0 0 3px var(--mns-accent-soft),var(--mns-shadow)}',
    '.mns-card.mns-target{border-color:var(--mns-accent)}',
    '.mns-kind{font-size:10.5px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--mns-mute);margin:0 0 6px}',
    '.mns-title{margin:0 0 8px;font-weight:600;letter-spacing:-.01em;line-height:1.25;color:var(--mns-fg)}',
    '.mns-l1 .mns-title{font-size:19px}.mns-l2 .mns-title{font-size:16px}.mns-l3 .mns-title{font-size:14.5px}',
    '.mns-l0 .mns-title{font-size:14.5px}',
    '.mns-body{font-size:12.75px;line-height:1.5;color:var(--mns-fg2)}',
    '.mns-row{display:flex;gap:7px;margin:3px 0;min-width:0}',
    '.mns-row>span:last-child{min-width:0;overflow-wrap:anywhere}',
    '.mns-p{margin:0 0 6px}',
    '.mns-subhead{margin:10px 0 3px;font-size:12.5px;font-weight:600;color:var(--mns-fg)}',
    '.mns-body>.mns-subhead:first-child{margin-top:0}',
    '.mns-bul{flex:none;width:4px;height:4px;border-radius:50%;background:var(--mns-mute);margin:8px 3px 0 2px}',
    '.mns-num{flex:none;min-width:14px;color:var(--mns-mute);font-variant-numeric:tabular-nums}',
    '.mns-box{flex:none;width:11px;height:11px;margin-top:3px;border-radius:3px;border:1.25px solid var(--mns-mute);box-sizing:border-box}',
    '.mns-box.mns-done{background:var(--mns-accent);border-color:var(--mns-accent)}',
    '.mns-row.mns-checked>span:last-child{text-decoration:line-through;color:var(--mns-mute)}',
    '.mns-sub{padding-left:14px}',
    '.mns-more{margin-top:6px;font-size:11.5px;color:var(--mns-mute)}',
    '.mns-links{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}',
    '.mns-link{font-size:12px;padding:2px 6px;border-radius:4px;background:var(--mns-chip);color:var(--mns-fg2);cursor:pointer;text-decoration:none}',
    '.mns-link:hover{color:var(--mns-fg)}',
    '.mns-handle{position:absolute;top:50%;right:-6px;width:11px;height:11px;margin-top:-5.5px;border-radius:50%;box-sizing:border-box;',
    ' background:var(--mns-card);border:1.5px solid var(--mns-mute);cursor:crosshair;opacity:0;transition:opacity .12s,border-color .12s,transform .12s}',
    '.mns-card:hover .mns-handle,.mns-card.mns-sel .mns-handle{opacity:1}',
    '.mns-handle:hover{border-color:var(--mns-accent);transform:scale(1.2)}',

    '.mns-hud{position:absolute;opacity:0;transform:translateY(4px);transition:opacity .25s ease,transform .25s ease;pointer-events:none}',
    '.mns-canvas.mns-ready .mns-hud{opacity:1;transform:none;pointer-events:auto}',
    '.mns-bar{left:50%;bottom:18px;margin-left:0;display:flex;align-items:center;gap:2px;padding:4px;border-radius:10px;',
    ' background:var(--mns-card);border:1px solid var(--mns-line);box-shadow:var(--mns-shadow);font-size:13px;translate:-50% 0}',
    '.mns-btn{height:28px;min-width:28px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--mns-fg2);',
    ' font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
    '.mns-btn:hover{background:var(--mns-chip);color:var(--mns-fg)}',
    '.mns-zoom{min-width:48px;color:var(--mns-mute);font-variant-numeric:tabular-nums}',
    '.mns-sep{width:1px;height:16px;background:var(--mns-line);margin:0 4px}',
    '.mns-exit{color:var(--mns-fg)}',
    '.mns-head{left:22px;top:16px;max-width:60%}',
    '.mns-page{font-size:13px;font-weight:600;color:var(--mns-fg2);margin:0 0 3px}',
    '.mns-hint{font-size:11.5px;color:var(--mns-mute)}',
  ].join('\n');
  document.head.appendChild(style);

  /* --------------------------------------------------------------- toggle */

  function icon() {
    var svg = s('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3' });
    svg.appendChild(s('rect', { x: '1.5', y: '2', width: '6', height: '5', rx: '1.3' }));
    svg.appendChild(s('rect', { x: '9', y: '5.5', width: '5.5', height: '4.5', rx: '1.3' }));
    svg.appendChild(s('rect', { x: '3', y: '10', width: '5.5', height: '4', rx: '1.3' }));
    return svg;
  }

  var toggle = document.createElement('div');
  toggle.setAttribute('data-modable', 'notion-spatial-toggle');
  toggle.className = 'mns-toggle';
  toggle.setAttribute('role', 'button');
  toggle.setAttribute('tabindex', '0');
  toggle.setAttribute('aria-label', 'Spatial');
  toggle.appendChild(icon());
  var toggleLabel = h('span', null, 'Spatial');
  toggle.appendChild(toggleLabel);
  toggle.addEventListener('click', function () { state ? exit() : enter(); });
  toggle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state ? exit() : enter(); }
  });

  // Next to Share, in the same flex row, so it inherits Notion's spacing.
  function placeToggle() {
    var buttons = document.querySelector('.notion-topbar-action-buttons');
    if (!buttons) return false;
    var share = buttons.querySelector('[aria-label="Share"]');
    if (share) {
      var item = share;
      while (item.parentElement && item.parentElement !== buttons && item.parentElement.children.length === 1) {
        item = item.parentElement;
      }
      if (item.parentElement && item.parentElement !== buttons) {
        item.parentElement.insertBefore(toggle, item);
        return true;
      }
    }
    buttons.insertBefore(toggle, buttons.firstChild);
    return true;
  }
  if (!placeToggle()) { style.remove(); return { ok: false, reason: 'no place for the Spatial control' }; }

  // Notion re-renders the topbar on navigation; put the control back, and
  // leave Spatial Mode if the page underneath it changed.
  // Checked straight in the callback (already batched per task) rather than
  // on the next frame: a hidden window never gets that frame.
  var href = location.href;
  var mo = new MutationObserver(function () {
    if (location.href !== href) {
      href = location.href;
      if (state) exit(true);
    }
    if (!toggle.isConnected) placeToggle();
  });
  mo.observe(document.body, { childList: true, subtree: true });
  cleanups.push(function () { mo.disconnect(); });

  /* ------------------------------------------------------------ read page */

  var HEADINGS = { header: 1, sub_header: 2, sub_sub_header: 3 };
  var KIND = {
    1: 'Heading 1', 2: 'Heading 2', 3: 'Heading 3',
    text: 'Text', bulleted_list: 'List', numbered_list: 'Numbered list', to_do: 'To-do',
    toggle: 'Toggle', quote: 'Quote', callout: 'Callout', code: 'Code',
  };

  function typeOf(block) {
    var m = String(block.className).match(/notion-([a-z_]+)-block/);
    return m ? m[1] : 'block';
  }
  function ownText(block) {
    var leaf = block.querySelector('[data-content-editable-leaf]');
    var t = leaf ? leaf.textContent : block.innerText;
    return (t || '').replace(/\s+/g, ' ').trim();
  }
  function readItem(block, type, depth) {
    var item = { type: type, text: ownText(block), depth: depth };
    if (type === 'to_do') {
      var box = block.querySelector('input[type="checkbox"]');
      item.checked = !!(box && box.checked);
    }
    if (type === 'numbered_list') {
      var leaf = block.querySelector('[data-content-editable-leaf]');
      var n = leaf && (leaf.getAttribute('aria-roledescription') || '').match(/(\d+)/);
      item.num = n ? n[1] : '';
    }
    return item;
  }

  function readPage() {
    var content = document.querySelector('.notion-page-content');
    if (!content) return null;
    var sections = [];
    var cur = null;

    Array.prototype.forEach.call(content.children, function (block) {
      var id = block.getAttribute('data-block-id');
      if (!id) return;
      var type = typeOf(block);
      var level = HEADINGS[type];
      // Cards are sections, not paragraphs: only H2/H3 start one. An H4 is a
      // subsection and reads as a subheading inside its parent's card.
      if (level) {
        if (level <= 2 || !cur) {
          cur = { id: id, level: level, title: ownText(block), el: block, items: [], links: [], blocks: 0, subs: 0 };
          sections.push(cur);
        } else {
          cur.items.push({ type: 'subhead', text: ownText(block), depth: 0 });
          cur.subs++;
        }
        return;
      }
      if (type === 'divider') return;
      if (!cur) {
        cur = { id: id, level: 0, title: '', el: block, items: [], links: [], blocks: 0, subs: 0 };
        sections.push(cur);
      }
      cur.blocks++;
      var item = readItem(block, type, 0);
      if (item.text) cur.items.push(item);
      // Nested children one level down (indented list items and the like).
      block.querySelectorAll('[data-block-id]').forEach(function (child) {
        var cid = child.getAttribute('data-block-id');
        if (cid === id || !child.querySelector('[data-content-editable-leaf]')) return;
        var parentBlock = child.parentElement && child.parentElement.closest('[data-block-id]');
        if (!parentBlock || parentBlock.getAttribute('data-block-id') !== id) return;
        var sub = readItem(child, typeOf(child), 1);
        if (sub.text) cur.items.push(sub);
      });
      block.querySelectorAll('a[href]').forEach(function (a) {
        var text = (a.textContent || '').trim();
        if (text) cur.links.push({ text: text.slice(0, 40), el: a });
      });
    });

    // A page that is one long run of text with no headings still deserves a
    // canvas: chunk it into cards of a few blocks each.
    if (sections.length === 1 && sections[0].level === 0 && sections[0].items.length > 6) {
      var only = sections[0];
      sections = [];
      for (var i = 0; i < only.items.length; i += 5) {
        sections.push({ id: only.id + ':' + i, level: 0, title: '', el: only.el, items: only.items.slice(i, i + 5), links: [], blocks: 5, subs: 0 });
      }
    }

    var titleEl = document.querySelector('.notion-frame h1[contenteditable]');
    var title = titleEl ? titleEl.textContent.trim() : '';
    var m = location.pathname.match(/([0-9a-f]{32})/i) || location.href.match(/([0-9a-f]{32})/i);
    return { sections: sections, title: title, pageId: m ? m[1] : location.pathname };
  }

  /* -------------------------------------------------------------- storage */

  function load(pageId) {
    try { return JSON.parse(localStorage.getItem('modable-notion-spatial:v2:' + pageId)) || {}; } catch (e) { return {}; }
  }
  function save() {
    if (!state) return;
    var pos = {};
    state.cards.forEach(function (c) { pos[c.id] = [Math.round(c.x), Math.round(c.y)]; });
    try {
      localStorage.setItem('modable-notion-spatial:v2:' + state.pageId, JSON.stringify({
        pos: state.moved ? pos : undefined,
        edges: state.edges.map(function (e) { return [e.a.id, e.b.id]; }),
      }));
    } catch (e) {}
  }

  /* --------------------------------------------------------------- theme */

  function applyTheme(canvas) {
    var dark = document.body.classList.contains('dark') || document.body.classList.contains('notion-dark-theme');
    var frame = document.querySelector('.notion-frame');
    var bg = frame ? getComputedStyle(frame).backgroundColor : '';
    if (!bg || bg === 'rgba(0, 0, 0, 0)') bg = dark ? 'rgb(25, 25, 25)' : 'rgb(255, 255, 255)';
    var v = dark ? {
      bg: bg, card: '#212121', fg: 'rgba(255,255,255,.92)', fg2: 'rgba(255,255,255,.74)', mute: 'rgba(255,255,255,.42)',
      line: 'rgba(255,255,255,.08)', 'line-hi': 'rgba(255,255,255,.16)', chip: 'rgba(255,255,255,.06)',
      dot: 'rgba(255,255,255,.07)', edge: 'rgba(255,255,255,.34)', 'edge-hi': 'rgba(255,255,255,.62)',
      accent: 'hsl(205 66% 66%)', 'accent-soft': 'hsla(205,66%,66%,.18)',
      shadow: '0 1px 2px rgba(0,0,0,.35),0 8px 24px -8px rgba(0,0,0,.45)',
      'shadow-lift': '0 2px 4px rgba(0,0,0,.35),0 18px 40px -10px rgba(0,0,0,.6)',
    } : {
      bg: bg, card: '#ffffff', fg: 'rgba(28,27,24,.94)', fg2: 'rgba(28,27,24,.74)', mute: 'rgba(28,27,24,.45)',
      line: 'rgba(15,15,15,.09)', 'line-hi': 'rgba(15,15,15,.18)', chip: 'rgba(15,15,15,.05)',
      dot: 'rgba(15,15,15,.09)', edge: 'rgba(15,15,15,.3)', 'edge-hi': 'rgba(15,15,15,.6)',
      accent: 'hsl(205 62% 46%)', 'accent-soft': 'hsla(205,62%,46%,.16)',
      shadow: '0 1px 2px rgba(15,15,15,.06),0 6px 18px -6px rgba(15,15,15,.12)',
      'shadow-lift': '0 2px 4px rgba(15,15,15,.08),0 18px 36px -10px rgba(15,15,15,.22)',
    };
    for (var k in v) canvas.style.setProperty('--mns-' + k, v[k]);
    toggle.style.setProperty('--mns-accent', v.accent);
  }

  /* -------------------------------------------------------------- layout */

  var CARD_W = 300, COL_GAP = 52, ROW_GAP = 44;

  // Deterministic and centred: the page's first section sits in the middle
  // cell of the smallest odd square grid that fits, and the rest fill rings
  // around it clockwise from the top-left, so reading order still runs round
  // the core. Rows take the height of their tallest card and cards centre
  // vertically in them, so nothing overlaps whatever the content.
  function layout(cards) {
    var n = cards.length;
    var k = 1;
    while (k * k < n) k += 2;
    var mid = (k - 1) / 2;
    var cells = [];
    for (var r = 0; r < k; r++) {
      for (var c = 0; c < k; c++) {
        var dx = c - mid, dy = r - mid;
        var ring = Math.max(Math.abs(dx), Math.abs(dy));
        var ang = ring ? (Math.atan2(dy, dx) * 180 / Math.PI + 135 + 360) % 360 : 0;
        cells.push({ r: r, c: c, ring: ring, ang: ang });
      }
    }
    cells.sort(function (a, b) { return a.ring - b.ring || a.ang - b.ang; });

    var rowH = {}, used = { r: {}, c: {} };
    cards.forEach(function (card, i) {
      var cell = cells[i];
      card.cell = cell;
      used.r[cell.r] = used.c[cell.c] = true;
      rowH[cell.r] = Math.max(rowH[cell.r] || 0, card.h);
    });
    // Collapse rows and columns no card landed in, so a small page stays tight.
    var rowY = {}, colX = {}, y = 0, x = 0;
    for (var rr = 0; rr < k; rr++) if (used.r[rr]) { rowY[rr] = y; y += rowH[rr] + ROW_GAP; }
    for (var cc = 0; cc < k; cc++) if (used.c[cc]) { colX[cc] = x; x += CARD_W + COL_GAP; }
    cards.forEach(function (card) {
      card.x = colX[card.cell.c];
      card.y = rowY[card.cell.r] + Math.round((rowH[card.cell.r] - card.h) / 2);
    });
  }

  /* --------------------------------------------------------------- cards */

  function buildCard(sec) {
    var el = mark(h('div', 'mns-card mns-l' + sec.level), 'card');
    var kind = sec.level ? KIND[sec.level] : (KIND[sec.items[0] && sec.items[0].type] || 'Block');
    var count = sec.subs
      ? ' · ' + sec.subs + (sec.subs === 1 ? ' subsection' : ' subsections')
      : sec.blocks ? ' · ' + sec.blocks + (sec.blocks === 1 ? ' block' : ' blocks') : '';
    el.appendChild(h('div', 'mns-kind', kind + count));
    if (sec.title) el.appendChild(h('div', 'mns-title', sec.title));

    var body = h('div', 'mns-body');
    // A flat section shows its first ten lines. A section with subsections
    // always shows every subheading with a few lines under each, so no part
    // of it silently disappears behind "+N more".
    var shown = [], hidden = 0, run = 0;
    var per = sec.subs ? 3 : 10;
    sec.items.forEach(function (it) {
      if (it.type === 'subhead') { run = 0; shown.push(it); return; }
      if (run < per) { run++; shown.push(it); } else hidden++;
    });
    shown.forEach(function (it) {
      var text = it.text.length > 180 ? it.text.slice(0, 177) + '…' : it.text;
      if (it.type === 'subhead') {
        body.appendChild(h('div', 'mns-subhead', text));
        return;
      }
      if (it.type === 'text' || it.type === 'quote' || it.type === 'callout') {
        body.appendChild(h('p', 'mns-p', text));
        return;
      }
      var row = h('div', 'mns-row' + (it.depth ? ' mns-sub' : '') + (it.checked ? ' mns-checked' : ''));
      if (it.type === 'to_do') row.appendChild(h('span', 'mns-box' + (it.checked ? ' mns-done' : '')));
      else if (it.type === 'numbered_list') row.appendChild(h('span', 'mns-num', (it.num || '•') + '.'));
      else row.appendChild(h('span', 'mns-bul'));
      row.appendChild(h('span', null, text));
      body.appendChild(row);
    });
    if (sec.items.length) el.appendChild(body);
    if (hidden) el.appendChild(h('div', 'mns-more', '+' + hidden + ' more'));

    if (sec.links.length) {
      var links = h('div', 'mns-links');
      sec.links.slice(0, 6).forEach(function (l) {
        var chip = h('span', 'mns-link', '↗ ' + l.text);
        chip.addEventListener('click', function (e) {
          e.stopPropagation();
          // Notion's own anchor, so navigation is whatever Notion already does.
          exit(false, function () { if (l.el.isConnected) l.el.click(); });
        });
        links.appendChild(chip);
      });
      el.appendChild(links);
    }

    var handle = h('div', 'mns-handle');
    handle.title = 'Drag to connect';
    el.appendChild(handle);
    return { id: sec.id, sec: sec, el: el, handle: handle, x: 0, y: 0, w: CARD_W, h: 0 };
  }

  function placeCard(c) { c.el.style.transform = 'translate(' + c.x + 'px,' + c.y + 'px)'; }

  /* --------------------------------------------------------------- edges */

  function anchors(a, b) {
    var ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    var dx = bc.x - ac.x, dy = bc.y - ac.y;
    if (Math.abs(dx) > (a.w + b.w) / 2 - 40 || Math.abs(dx) * 0.8 > Math.abs(dy)) {
      var r = dx > 0;
      return { p1: { x: r ? a.x + a.w : a.x, y: ac.y }, p2: { x: r ? b.x : b.x + b.w, y: bc.y }, n1: { x: r ? 1 : -1, y: 0 }, n2: { x: r ? -1 : 1, y: 0 } };
    }
    var d = dy > 0;
    return { p1: { x: ac.x, y: d ? a.y + a.h : a.y }, p2: { x: bc.x, y: d ? b.y : b.y + b.h }, n1: { x: 0, y: d ? 1 : -1 }, n2: { x: 0, y: d ? -1 : 1 } };
  }
  function curve(p1, n1, p2, n2) {
    var dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    var k = Math.max(36, dist * 0.4);
    return 'M' + p1.x + ',' + p1.y + ' C' + (p1.x + n1.x * k) + ',' + (p1.y + n1.y * k) + ' ' +
      (p2.x + n2.x * k) + ',' + (p2.y + n2.y * k) + ' ' + p2.x + ',' + p2.y;
  }
  function drawEdge(e) {
    var an = anchors(e.a, e.b);
    var d = curve(an.p1, an.n1, an.p2, an.n2);
    e.path.setAttribute('d', d);
    e.hit.setAttribute('d', d);
    e.end.setAttribute('cx', an.p2.x);
    e.end.setAttribute('cy', an.p2.y);
  }
  function addEdge(a, b) {
    if (a === b) return;
    if (state.edges.some(function (e) { return (e.a === a && e.b === b) || (e.a === b && e.b === a); })) return;
    var g = s('g', { class: 'mns-edge-g' });
    var e = { a: a, b: b, g: g, path: s('path', { class: 'mns-edge' }), hit: s('path', { class: 'mns-edge-hit' }), end: s('circle', { class: 'mns-edge-end', r: '2.6' }) };
    g.appendChild(e.path); g.appendChild(e.hit); g.appendChild(e.end);
    e.hit.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); select(null, e); });
    e.hit.addEventListener('dblclick', function (ev) { ev.stopPropagation(); removeEdge(e); });
    state.svg.appendChild(g);
    state.edges.push(e);
    drawEdge(e);
  }
  function removeEdge(e) {
    e.g.remove();
    state.edges = state.edges.filter(function (x) { return x !== e; });
    if (state.selEdge === e) state.selEdge = null;
    save();
  }
  function redrawFor(card) {
    state.edges.forEach(function (e) { if (e.a === card || e.b === card) drawEdge(e); });
  }

  function select(card, edge) {
    if (state.selCard) state.selCard.el.classList.remove('mns-sel');
    if (state.selEdge) state.selEdge.g.classList.remove('mns-sel');
    state.selCard = card || null;
    state.selEdge = edge || null;
    if (card) card.el.classList.add('mns-sel');
    if (edge) edge.g.classList.add('mns-sel');
  }

  /* ---------------------------------------------------------------- view */

  function apply() {
    var v = state.view;
    state.world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.z + ')';
    var grid = 24 * v.z;
    state.canvas.style.backgroundSize = grid + 'px ' + grid + 'px';
    state.canvas.style.backgroundPosition = v.x + 'px ' + v.y + 'px';
    state.zoomLabel.textContent = Math.round(v.z * 100) + '%';
  }
  function bounds() {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    state.cards.forEach(function (c) {
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function fitView() {
    var b = bounds();
    var W = state.rect.width, H = state.rect.height;
    var padX = 56, padTop = 64, padBottom = 76;
    var z = clamp(Math.min((W - padX * 2) / b.w, (H - padTop - padBottom) / b.h), 0.25, 1);
    return { z: z, x: (W - b.w * z) / 2 - b.x * z, y: padTop + Math.max(0, (H - padTop - padBottom - b.h * z) / 2) - b.y * z };
  }
  function animateView(to) {
    var from = { x: state.view.x, y: state.view.y, z: state.view.z };
    // A hidden window gets no frames; land on the target instead of stalling.
    if (reduced || document.hidden) { state.view = to; apply(); return; }
    var t0 = performance.now();
    cancelAnimationFrame(state.viewAnim);
    (function step(now) {
      if (!state) return;
      var t = Math.min(1, (now - t0) / 320);
      var e = 1 - Math.pow(1 - t, 3);
      state.view = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e };
      apply();
      if (t < 1) state.viewAnim = requestAnimationFrame(step);
    })(t0);
  }
  function zoomAt(factor, sx, sy) {
    var v = state.view;
    var z = clamp(v.z * factor, 0.2, 2.5);
    var k = z / v.z;
    state.view = { z: z, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
    apply();
  }
  function positionCanvas() {
    var frame = document.querySelector('.notion-frame');
    if (!frame || !state) return;
    var r = frame.getBoundingClientRect();
    state.rect = r;
    var st = state.canvas.style;
    st.left = r.left + 'px'; st.top = r.top + 'px'; st.width = r.width + 'px'; st.height = r.height + 'px';
  }

  /* --------------------------------------------------------------- enter */

  function enter() {
    if (state) return;
    var page = readPage();
    var frame = document.querySelector('.notion-frame');
    var scroller = frame && frame.querySelector('.notion-scroller');
    if (!page || !page.sections.length || !frame || !scroller) {
      if (toggle.animate) toggle.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 220 });
      return;
    }
    // Nothing should keep typing into a document the user can no longer see.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    var canvas = mark(h('div', 'mns-canvas'), 'canvas');
    canvas.setAttribute('tabindex', '-1');
    canvas.setAttribute('aria-label', 'Spatial canvas');
    var world = mark(h('div', 'mns-world'), 'world');
    var svg = s('svg', { class: 'mns-edges' });
    world.appendChild(svg);
    canvas.appendChild(world);

    var head = h('div', 'mns-hud mns-head');
    if (page.title) head.appendChild(h('div', 'mns-page', page.title));
    head.appendChild(h('div', 'mns-hint', 'Drag cards · scroll to pan · pinch or ⌘-scroll to zoom · drag a card’s edge dot to connect'));
    canvas.appendChild(head);

    var bar = h('div', 'mns-hud mns-bar');
    function btn(label, title, fn, cls) {
      var b = h('button', 'mns-btn' + (cls ? ' ' + cls : ''), label);
      b.type = 'button'; b.title = title;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      bar.appendChild(b);
      return b;
    }
    btn('−', 'Zoom out', function () { zoomAt(1 / 1.2, state.rect.width / 2, state.rect.height / 2); });
    var zoomLabel = btn('100%', 'Reset zoom to 100%', function () { zoomAt(1 / state.view.z, state.rect.width / 2, state.rect.height / 2); }, 'mns-zoom');
    btn('+', 'Zoom in', function () { zoomAt(1.2, state.rect.width / 2, state.rect.height / 2); });
    bar.appendChild(h('span', 'mns-sep'));
    btn('Fit', 'Fit all cards (⌘0)', function () { animateView(fitView()); });
    btn('Tidy', 'Return cards to their original arrangement', tidy);
    bar.appendChild(h('span', 'mns-sep'));
    btn('Exit Spatial', 'Back to the page (Esc)', function () { exit(); }, 'mns-exit');
    canvas.appendChild(bar);

    state = {
      pageId: page.pageId, canvas: canvas, world: world, svg: svg, zoomLabel: zoomLabel,
      scroller: scroller, scrollerStyle: scroller.getAttribute('style'),
      cards: [], edges: [], view: { x: 0, y: 0, z: 1 }, selCard: null, selEdge: null, moved: false, listeners: [],
    };
    applyTheme(canvas);
    document.body.appendChild(canvas);
    positionCanvas();

    // Measure first, lay out second: card heights come from real content.
    page.sections.forEach(function (sec) {
      var c = buildCard(sec);
      c.el.style.visibility = 'hidden';
      world.appendChild(c.el);
      state.cards.push(c);
    });
    state.cards.forEach(function (c) { c.h = c.el.offsetHeight; });
    layout(state.cards);

    var saved = load(page.pageId);
    if (saved.pos) {
      state.moved = true;
      state.cards.forEach(function (c) { var p = saved.pos[c.id]; if (p) { c.x = p[0]; c.y = p[1]; } });
    }
    state.cards.forEach(function (c) { placeCard(c); c.el.style.visibility = ''; });
    var byId = {};
    state.cards.forEach(function (c) { byId[c.id] = c; });
    (saved.edges || []).forEach(function (p) { if (byId[p[0]] && byId[p[1]]) addEdge(byId[p[0]], byId[p[1]]); });

    state.view = fitView();
    apply();
    wire(canvas);

    toggle.classList.add('mns-on');
    toggleLabel.textContent = 'Exit Spatial';

    // The transformation: the page softens, then each section lifts off from
    // where it sits on screen and settles into its place on the canvas.
    var ss = scroller.style;
    ss.transition = 'opacity 260ms ease, transform 320ms cubic-bezier(.2,.8,.2,1)';
    ss.transformOrigin = '50% 30%';
    // A forced style flush, not a frame callback, separates the start state
    // from the end state, so entering cannot stall in a backgrounded window.
    void canvas.offsetWidth;
    ss.opacity = '0.14';
    ss.transform = 'scale(0.985)';
    canvas.classList.add('mns-in');

    var rect = state.rect, v = state.view;
    state.cards.forEach(function (c, i) {
      if (reduced) return;
      var r = c.sec.el.getBoundingClientRect();
      var onScreen = r.bottom > rect.top && r.top < rect.bottom;
      var sx = (r.left - rect.left - v.x) / v.z;
      var sy = ((onScreen ? r.top : rect.bottom + 24) - rect.top - v.y) / v.z;
      var from = 'translate(' + sx + 'px,' + sy + 'px) scale(' + (1 / v.z).toFixed(3) + ')';
      c.el.style.transformOrigin = '0 0';
      c.el.animate([
        { transform: from, opacity: onScreen ? 0.35 : 0 },
        { transform: 'translate(' + c.x + 'px,' + c.y + 'px)', opacity: 1 },
      ], { duration: 600, delay: 100 + Math.min(i * 14, 200), easing: 'cubic-bezier(.33,.7,.2,1)', fill: 'backwards' });
    });
    if (svg.animate && !reduced) svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 620, fill: 'backwards' });

    state.readyTimer = setTimeout(function () {
      if (state && state.canvas === canvas) { canvas.classList.add('mns-ready'); canvas.focus({ preventScroll: true }); }
    }, reduced ? 0 : 600);
  }

  /* ---------------------------------------------------------------- exit */

  function exit(immediate, after) {
    if (!state || state.exiting) return;
    var st = state;
    st.exiting = true;
    clearTimeout(st.readyTimer);
    cancelAnimationFrame(st.viewAnim);
    st.listeners.forEach(function (off) { off(); });
    st.listeners = [];

    function finish() {
      st.canvas.remove();
      if (st.scrollerStyle == null) st.scroller.removeAttribute('style');
      else st.scroller.setAttribute('style', st.scrollerStyle);
      if (state === st) state = null;
      toggle.classList.remove('mns-on');
      toggleLabel.textContent = 'Spatial';
      if (after) after();
    }
    if (immediate || reduced) { finish(); return; }

    var rect = st.rect, v = st.view;
    st.canvas.classList.remove('mns-ready');
    st.cards.forEach(function (c, i) {
      var r = c.sec.el.isConnected ? c.sec.el.getBoundingClientRect() : null;
      var onScreen = r && r.bottom > rect.top && r.top < rect.bottom;
      var sx = r ? (r.left - rect.left - v.x) / v.z : c.x;
      var sy = ((onScreen ? r.top : rect.bottom + 24) - rect.top - v.y) / v.z;
      c.el.animate([
        { transform: 'translate(' + c.x + 'px,' + c.y + 'px)', opacity: 1 },
        { transform: 'translate(' + sx + 'px,' + sy + 'px) scale(' + (1 / v.z).toFixed(3) + ')', opacity: 0 },
      ], { duration: 340, delay: Math.min(i * 8, 90), easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    });
    st.svg.style.opacity = '0';
    setTimeout(function () {
      st.canvas.classList.remove('mns-in');
      st.scroller.style.opacity = '';
      st.scroller.style.transform = '';
    }, 200);
    setTimeout(finish, 480);
  }

  function tidy() {
    var from = state.cards.map(function (c) { return { x: c.x, y: c.y }; });
    layout(state.cards);
    state.moved = false;
    state.cards.forEach(function (c, i) {
      placeCard(c);
      if (!reduced) c.el.animate([
        { transform: 'translate(' + from[i].x + 'px,' + from[i].y + 'px)' },
        { transform: 'translate(' + c.x + 'px,' + c.y + 'px)' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
      redrawFor(c);
    });
    save();
    animateView(fitView());
  }

  /* ------------------------------------------------------------ gestures */

  function cardOf(node) {
    var el = node && node.closest && node.closest('.mns-card');
    if (!el) return null;
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].el === el) return state.cards[i];
    return null;
  }
  function toWorld(cx, cy) {
    return { x: (cx - state.rect.left - state.view.x) / state.view.z, y: (cy - state.rect.top - state.view.y) / state.view.z };
  }

  function wire(canvas) {
    var z = 10;
    function listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      state.listeners.push(function () { target.removeEventListener(type, fn, opts); });
    }
    // One gesture at a time; its move/up handlers live here so exit() can
    // always detach them, even mid-drag.
    function gesture(canvas, pointerId, move, up) {
      canvas.setPointerCapture(pointerId);
      var end = function () {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', end);
        canvas.removeEventListener('pointercancel', end);
        up();
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
    }

    listen(canvas, 'pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('.mns-bar') || e.target.closest('.mns-link')) return;
      var card = cardOf(e.target);

      // Connect: drag from a card's edge dot onto another card.
      if (card && e.target === card.handle) {
        e.preventDefault();
        var temp = s('path', { class: 'mns-edge-temp' });
        state.svg.appendChild(temp);
        var hover = null;
        gesture(canvas, e.pointerId, function (ev) {
          var p = toWorld(ev.clientX, ev.clientY);
          var start = { x: card.x + card.w, y: card.y + card.h / 2 };
          temp.setAttribute('d', curve(start, { x: 1, y: 0 }, p, { x: p.x > start.x ? -1 : 1, y: 0 }));
          var over = cardOf(document.elementFromPoint(ev.clientX, ev.clientY));
          if (over === card) over = null;
          if (over !== hover) {
            if (hover) hover.el.classList.remove('mns-target');
            hover = over;
            if (hover) hover.el.classList.add('mns-target');
          }
        }, function () {
          temp.remove();
          if (hover && state) { hover.el.classList.remove('mns-target'); addEdge(card, hover); save(); }
        });
        return;
      }

      // Drag a card.
      if (card) {
        e.preventDefault();
        select(card);
        card.el.style.zIndex = String(++z);
        var sx = e.clientX, sy = e.clientY, ox = card.x, oy = card.y, moved = false;
        gesture(canvas, e.pointerId, function (ev) {
          var dx = (ev.clientX - sx) / state.view.z, dy = (ev.clientY - sy) / state.view.z;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
          if (!moved) { moved = true; card.el.classList.add('mns-dragging'); }
          card.x = ox + dx; card.y = oy + dy;
          placeCard(card);
          redrawFor(card);
        }, function () {
          card.el.classList.remove('mns-dragging');
          if (moved && state) { state.moved = true; save(); }
        });
        return;
      }

      // Pan the canvas.
      select(null);
      var px = e.clientX, py = e.clientY, vx = state.view.x, vy = state.view.y;
      canvas.classList.add('mns-panning');
      gesture(canvas, e.pointerId, function (ev) {
        state.view.x = vx + ev.clientX - px;
        state.view.y = vy + ev.clientY - py;
        apply();
      }, function () { canvas.classList.remove('mns-panning'); });
    });

    // Double-click a card: back to the page, at that section.
    // Hit-tested by position: the drag's pointer capture retargets dblclick
    // to the canvas itself, so e.target never names the card.
    listen(canvas, 'dblclick', function (e) {
      var hit = document.elementFromPoint(e.clientX, e.clientY);
      var card = cardOf(hit);
      if (!card || hit === card.handle) return;
      var el = card.sec.el;
      exit(false, function () { if (el.isConnected) el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' }); });
    });

    // Trackpad: two-finger scroll pans, pinch (ctrlKey) or ⌘-scroll zooms.
    listen(canvas, 'wheel', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        var unit = e.deltaMode === 1 ? 16 : 1;
        // Pinch sends many small deltas; a mouse wheel sends few large ones.
        // Capping each step keeps one notch from jumping 3×.
        var f = clamp(Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0025)), 0.8, 1.25);
        zoomAt(f, e.clientX - state.rect.left, e.clientY - state.rect.top);
      } else {
        state.view.x -= e.deltaX;
        state.view.y -= e.deltaY;
        apply();
      }
    }, { passive: false });

    // Keys stay inside the canvas so Notion's shortcuts cannot act on a page
    // that is not visible.
    listen(canvas, 'keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); exit(); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && state.selEdge) { e.preventDefault(); removeEdge(state.selEdge); }
      else if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); animateView(fitView()); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAt(1.2, state.rect.width / 2, state.rect.height / 2); }
      else if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); zoomAt(1 / 1.2, state.rect.width / 2, state.rect.height / 2); }
      if (!e.metaKey) e.stopPropagation();
    });

    var ro = new ResizeObserver(function () { positionCanvas(); });
    ro.observe(document.querySelector('.notion-frame'));
    state.listeners.push(function () { ro.disconnect(); });
    listen(window, 'resize', positionCanvas);
  }

  /* ------------------------------------------------------------ teardown */

  hooks[KEY] = function () {
    exit(true);
    cleanups.forEach(function (off) { try { off(); } catch (e) {} });
    cleanups = [];
    toggle.remove();
    style.remove();
    document.querySelectorAll('[data-modable^="notion-spatial"]').forEach(function (n) { n.remove(); });
    delete hooks[KEY];
  };

  return { ok: true, placed: toggle.isConnected };
})();
