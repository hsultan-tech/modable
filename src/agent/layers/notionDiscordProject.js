/*
 * Discord → Notion Project — the Notion half. A Modable layer for the Notion
 * desktop app.
 *
 * Shows a project built from real Discord messages as a page-shaped view over
 * the current Notion page: title, properties, overview, then Tasks, Decisions,
 * Blockers, Open Questions and Resources — only the sections that have
 * something in them. Every item carries the Discord message it came from;
 * clicking that source opens the message in Discord.
 *
 * Nothing is written to Notion. The view sits over .notion-frame the way
 * Spatial Mode's canvas does, a Page / Project switch beside Share moves
 * between them, and Remove takes every node and listener away again. Notion's
 * own page and editor are never touched.
 *
 * Anchors in the live renderer:
 *   .notion-frame                                  the page viewport the view covers
 *   .notion-topbar-action-buttons [aria-label="Share"]  where the switch sits
 *   body.notion-dark-theme, --c-texPri / --c-bacPri / --c-borPri …  Notion's
 *     own theme tokens; the view is drawn from them, so it follows light/dark
 *
 * Jumping back: Notion refuses discord:// links from the page, so a source
 * click calls window.__modableOpenSource — a CDP binding Modable's server
 * installs in this window (lib/handoff.js) — and the answer comes back through
 * window.__modableSourceAck. Without Modable running there is no binding, and
 * the item says so instead of failing silently.
 *
 * The stylesheet, the switch and the view are the claimed marks: all three
 * exist the moment the layer runs. Everything else is tagged through mark().
 */
(function (CONFIG) {
  var KEY = 'discord-notion-project';
  var ATTR = 'data-modable';
  var hooks = (window.__modableTeardown = window.__modableTeardown || {});

  // Running again replaces the project instead of stacking a second copy,
  // and keeps what was ticked.
  if (hooks[KEY]) { try { hooks[KEY]({ keep: true }); } catch (e) {} }
  document.querySelectorAll('[data-modable^="discord-notion-project"]').forEach(function (n) { n.remove(); });

  var P = CONFIG && CONFIG.payload;
  if (!P || !P.title || !P.origin) return { ok: false, reason: 'no project was given' };
  function frameEl() { return document.querySelector('.notion-frame'); }
  if (!frameEl() || !document.querySelector('.notion-topbar-action-buttons')) {
    return { ok: false, reason: 'Notion page frame or topbar not found — open a page first' };
  }

  var memory = (window.__modableDiscordProject = window.__modableDiscordProject || {});
  var mem = (memory[P.id] = memory[P.id] || { done: {} });
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cleanups = [];
  var home = location.pathname;
  var open = true;

  function mark(el, part) { el.setAttribute(ATTR, KEY + '-' + part); return el; }
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function icon(paths, size, cls, fill) {
    var el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', size); el.setAttribute('height', size);
    el.setAttribute('aria-hidden', 'true');
    if (cls) el.setAttribute('class', cls);
    paths.forEach(function (d) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      if (fill) { p.setAttribute('fill', 'currentColor'); }
      else {
        p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
        p.setAttribute('stroke-width', '1.8'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
      }
      el.appendChild(p);
    });
    return el;
  }
  var DISCORD = ['M19.6 5.3A18 18 0 0 0 15.2 4l-.6 1.1a16.5 16.5 0 0 0-5.2 0L8.8 4a18 18 0 0 0-4.4 1.3C1.6 9.5.9 13.6 1.2 17.6a18 18 0 0 0 5.4 2.7l1.2-1.8a11.6 11.6 0 0 1-1.8-.9l.4-.3a12.9 12.9 0 0 0 11.2 0l.4.3c-.6.3-1.2.6-1.8.9l1.2 1.8a18 18 0 0 0 5.4-2.7c.4-4.6-.7-8.7-3.2-12.3ZM8.5 15.2c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Zm7 0c-1.1 0-2-1-2-2.2s.9-2.2 2-2.2 2 1 2 2.2-.9 2.2-2 2.2Z'];
  var ARROW = ['M8 16 16 8', 'M9 8h7v7'];
  var CHECK = ['M5 12.5 10 17 19 7.5'];

  /* ---------------------------------------------------------------- style */

  var font = getComputedStyle(frameEl()).fontFamily;
  var style = document.createElement('style');
  style.setAttribute('data-modable', 'discord-notion-project-style');
  style.textContent = [
    '.dnp-root{--dnp-fg:var(--c-texPri,#37352f);--dnp-fg2:var(--c-texSec,#787774);--dnp-fg3:var(--c-texTer,#9b9a97);',
    '--dnp-bg:var(--c-bacPri,#fff);--dnp-bg2:var(--c-bacSec,#f7f6f3);--dnp-line:var(--c-borPri,#e9e9e7);',
    '--dnp-hover:var(--ca-bacIntTra,rgba(55,53,47,.06));--dnp-blue:var(--c-bluIcoAccPri,#2383e2);',
    '--dnp-red:var(--c-redTexSec,#d44c47);--dnp-green:var(--c-greTexSec,#448361);--dnp-orange:var(--c-oraTexSec,#d9730d);',
    '--dnp-blurple:#5865f2;font-family:' + font.replace(/[;{}]/g, '') + ';color:var(--dnp-fg);-webkit-font-smoothing:antialiased}',

    /* the switch, beside Share */
    '.dnp-switch{display:inline-flex;align-items:center;height:28px;padding:2px;margin-right:6px;border-radius:7px;',
    'background:var(--dnp-hover);box-sizing:border-box;flex-shrink:0;user-select:none}',
    '.dnp-seg{all:unset;display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border-radius:5px;',
    'font-size:13px;font-weight:500;line-height:1;color:var(--dnp-fg2);cursor:pointer;white-space:nowrap;',
    'transition:color .12s ease,background-color .12s ease,box-shadow .12s ease}',
    '.dnp-seg:hover{color:var(--dnp-fg)}',
    '.dnp-seg[aria-pressed="true"]{color:var(--dnp-fg);background:var(--dnp-bg);',
    'box-shadow:0 0 0 1px var(--dnp-line),0 1px 2px rgba(15,15,15,.08)}',
    '.dnp-seg:focus-visible{box-shadow:0 0 0 2px var(--dnp-blue)}',
    '.dnp-seg svg{color:var(--dnp-blurple);opacity:.9}',
    '.dnp-seg[aria-pressed="false"] svg{color:inherit;opacity:.7}',

    /* the view: exactly the page viewport, page-coloured */
    '.dnp-view{position:fixed;z-index:89;background:var(--dnp-bg);overflow:hidden;box-sizing:border-box}',
    '.dnp-view[hidden]{display:none}',
    '.dnp-scroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;scrollbar-gutter:stable}',
    '.dnp-page{box-sizing:border-box;width:100%;max-width:900px;margin:0 auto;padding:72px 96px 120px}',
    '@media (max-width:900px){.dnp-page{padding:56px 40px 96px}}',

    '.dnp-tools{display:flex;gap:2px;height:28px;margin:0 0 6px -8px;opacity:0;transition:opacity .15s ease}',
    '.dnp-page:hover .dnp-tools,.dnp-tools:focus-within{opacity:1}',
    '.dnp-tool{all:unset;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border-radius:6px;',
    'font-size:14px;color:var(--dnp-fg3);cursor:pointer;transition:background-color .1s ease,color .1s ease}',
    '.dnp-tool:hover{background:var(--dnp-hover);color:var(--dnp-fg2)}',
    '.dnp-tool:focus-visible{box-shadow:0 0 0 2px var(--dnp-blue)}',

    '.dnp-crumb{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--dnp-fg2);margin-bottom:10px;min-width:0}',
    '.dnp-crumb svg{color:var(--dnp-blurple);flex-shrink:0}',
    '.dnp-crumb .dnp-sep{color:var(--dnp-fg3)}',
    '.dnp-crumb span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dnp-title{font-size:40px;line-height:1.2;font-weight:700;letter-spacing:-.01em;margin:0 0 18px;color:var(--dnp-fg);',
    'overflow-wrap:anywhere}',

    '.dnp-props{display:grid;grid-template-columns:160px minmax(0,1fr);row-gap:2px;font-size:14px;margin-bottom:14px}',
    '.dnp-pk{display:flex;align-items:center;gap:8px;height:34px;padding:0 6px;color:var(--dnp-fg2)}',
    '.dnp-pk svg{color:var(--dnp-fg3)}',
    '.dnp-pv{display:flex;align-items:center;gap:8px;min-height:34px;padding:0 6px;color:var(--dnp-fg);min-width:0}',
    '.dnp-pill{display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 7px;border-radius:4px;font-size:13px;',
    'background:var(--dnp-hover);color:var(--dnp-fg);white-space:nowrap}',
    '.dnp-dot{width:7px;height:7px;border-radius:50%;background:var(--dnp-blurple);flex-shrink:0}',
    '.dnp-faint{color:var(--dnp-fg3)}',
    '.dnp-hr{height:1px;background:var(--dnp-line);margin:8px 0 6px}',

    '.dnp-h{display:flex;align-items:baseline;gap:8px;font-size:20px;line-height:1.3;font-weight:600;margin:30px 0 6px;color:var(--dnp-fg)}',
    '.dnp-h .dnp-n{font-size:14px;font-weight:500;color:var(--dnp-fg3)}',
    '.dnp-overview{font-size:16px;line-height:1.6;color:var(--dnp-fg);margin:2px 0 0;overflow-wrap:anywhere}',

    '.dnp-item{display:flex;align-items:flex-start;gap:8px;padding:5px 2px 6px;border-radius:4px}',
    '.dnp-mk{flex-shrink:0;display:flex;align-items:center;justify-content:center;width:22px;height:24px;color:var(--dnp-fg2)}',
    '.dnp-bul{width:6px;height:6px;border-radius:50%;background:currentColor}',
    '.dnp-k-dec .dnp-mk{color:var(--dnp-green)}',
    '.dnp-k-blk .dnp-mk{color:var(--dnp-red)}',
    '.dnp-k-q .dnp-mk{color:var(--dnp-fg3);font-size:15px;font-weight:600}',
    '.dnp-body{flex:1;min-width:0}',
    '.dnp-text{font-size:16px;line-height:1.5;color:var(--dnp-fg);overflow-wrap:anywhere}',
    '.dnp-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:3px;font-size:12px;line-height:18px;color:var(--dnp-fg3)}',

    '.dnp-check{all:unset;box-sizing:border-box;width:16px;height:16px;margin-top:4px;border-radius:3px;',
    'border:1.5px solid var(--dnp-fg2);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;',
    'transition:background-color .12s ease,border-color .12s ease}',
    '.dnp-check svg{opacity:0;transition:opacity .12s ease}',
    '.dnp-check[aria-checked="true"]{background:var(--dnp-blue);border-color:var(--dnp-blue)}',
    '.dnp-check[aria-checked="true"] svg{opacity:1}',
    '.dnp-check:focus-visible{box-shadow:0 0 0 2px var(--dnp-blue)}',
    '.dnp-done .dnp-text{color:var(--dnp-fg3);text-decoration:line-through;text-decoration-color:var(--dnp-fg3)}',
    '.dnp-owner,.dnp-due{display:inline-flex;align-items:center;gap:4px;font-size:13px;color:var(--dnp-fg2);white-space:nowrap}',
    '.dnp-owner{padding:0 5px;height:20px;border-radius:4px;background:var(--dnp-hover)}',
    '.dnp-due{color:var(--dnp-orange)}',
    '.dnp-done .dnp-due{color:var(--dnp-fg3)}',

    '.dnp-src{all:unset;display:inline-flex;align-items:center;gap:4px;max-width:100%;color:var(--dnp-fg3);cursor:pointer;',
    'border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color .12s ease}',
    '.dnp-src svg{flex-shrink:0;transition:transform .15s ease}',
    '.dnp-src:hover{color:var(--dnp-fg)}',
    '.dnp-src:hover svg{transform:translate(1px,-1px)}',
    '.dnp-src:focus-visible{box-shadow:0 0 0 2px var(--dnp-blue)}',
    '.dnp-src[data-state="busy"]{color:var(--dnp-fg2);cursor:progress}',
    '.dnp-src[data-state="ok"]{color:var(--dnp-green)}',
    '.dnp-src[data-state="err"]{color:var(--dnp-red);white-space:normal}',
    '.dnp-prime{color:var(--dnp-fg)}',
    '.dnp-more{all:unset;color:var(--dnp-fg3);cursor:pointer;padding:0 4px;border-radius:3px}',
    '.dnp-more:hover{color:var(--dnp-fg);background:var(--dnp-hover)}',
    '.dnp-srcs{display:flex;flex-direction:column;gap:2px;min-width:0;max-width:100%}',
    '.dnp-srcline{display:inline-flex;gap:6px;min-width:0}',

    '.dnp-res{display:inline-flex;align-items:baseline;gap:8px;min-width:0;max-width:100%}',
    '.dnp-res a{color:var(--dnp-fg);text-decoration:none;border-bottom:1px solid var(--dnp-line);font-size:16px;line-height:1.5;',
    'overflow-wrap:anywhere;transition:border-color .12s ease}',
    '.dnp-res a:hover{border-bottom-color:var(--dnp-fg2)}',
    '.dnp-res .dnp-dom{font-size:13px;color:var(--dnp-fg3);white-space:nowrap}',
    '.dnp-k-res .dnp-mk svg{color:var(--dnp-fg3)}',

    '.dnp-foot{margin-top:44px;padding-top:14px;border-top:1px solid var(--dnp-line);font-size:12px;line-height:18px;color:var(--dnp-fg3)}',
  ].join('');
  document.head.appendChild(style);

  /* ------------------------------------------------------------- helpers */

  function fmtDay(iso) {
    var d = new Date(iso);
    if (isNaN(+d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtWhen(iso) {
    var d = new Date(iso);
    if (isNaN(+d)) return '';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function domain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function itemKey(kind, text) { return kind + ':' + String(text).toLowerCase().replace(/\W+/g, ' ').trim().slice(0, 120); }

  /* ------------------------------------------------- jumping back to Discord */

  var pending = {};
  var seq = 0;
  function onAck(r) {
    var fn = r && pending[r.requestId];
    if (fn) { delete pending[r.requestId]; fn(r); }
  }
  window.__modableSourceAck = onAck;

  function sourceLabel(src) {
    var parts = ['Discord'];
    if (src.channelName) parts.push('#' + src.channelName);
    if (src.author) parts.push(src.author);
    return parts.join(' · ');
  }

  function setState(btn, state, text) {
    if (btn._t) { clearTimeout(btn._t); btn._t = 0; }
    btn.setAttribute('data-state', state || '');
    btn.lastChild.textContent = text || btn._label;
    if (state === 'ok' || state === 'err') {
      btn._t = setTimeout(function () { btn._t = 0; btn.setAttribute('data-state', ''); btn.lastChild.textContent = btn._label; },
        state === 'err' ? 5200 : 2200);
    }
  }

  function jump(src, btn) {
    if (btn.getAttribute('data-state') === 'busy') return;
    if (!src.channelId) { setState(btn, 'err', 'This message has no channel to open.'); return; }
    if (typeof window.__modableOpenSource !== 'function') {
      setState(btn, 'err', 'Modable is not connected to this window — open Modable to jump back to Discord.');
      return;
    }
    var id = 'dnp' + (++seq) + '-' + Date.now();
    setState(btn, 'busy', 'Opening in Discord…');
    var timer = setTimeout(function () {
      if (!pending[id]) return;
      delete pending[id];
      setState(btn, 'err', 'Discord did not answer. Is it running?');
    }, 15000);
    pending[id] = function (r) {
      clearTimeout(timer);
      if (!r.ok) return setState(btn, 'err', r.error || 'Could not open Discord.');
      setState(btn, r.exact || !src.messageId ? 'ok' : 'err', r.note || 'Opened in Discord');
    };
    try {
      window.__modableOpenSource(JSON.stringify({
        requestId: id, app: 'discord',
        serverId: src.serverId || '', channelId: src.channelId || '', messageId: src.messageId || '',
      }));
    } catch (e) {
      clearTimeout(timer);
      delete pending[id];
      setState(btn, 'err', 'Modable is not connected to this window — open Modable to jump back to Discord.');
    }
  }

  function sourceButton(src, label, title) {
    var b = mark(h('button', 'dnp-src'), 'source');
    b.type = 'button';
    b._label = label || sourceLabel(src);
    b.title = title || ((src.messageId ? 'Open this message in Discord' : 'Open in Discord') +
      (src.timestamp ? ' · ' + fmtWhen(src.timestamp) : ''));
    b.appendChild(icon(ARROW, 12));
    b.appendChild(h('span', null, b._label));
    b.addEventListener('click', function (e) { e.stopPropagation(); jump(src, b); });
    return b;
  }

  function sourcesRow(sources) {
    var list = (sources || []).filter(function (s) { return s && s.app === 'discord'; });
    if (!list.length) return null;
    var wrap = h('span', 'dnp-srcs');
    var line = h('span', 'dnp-srcline');
    line.appendChild(sourceButton(list[0]));
    wrap.appendChild(line);
    if (list.length > 1) {
      var more = mark(h('button', 'dnp-more', '+' + (list.length - 1) + ' more'), 'more');
      more.type = 'button';
      more.title = 'Also from ' + (list.length - 1) + ' other message' + (list.length > 2 ? 's' : '') + ' — show them';
      more.addEventListener('click', function () {
        more.remove();
        list.slice(1).forEach(function (s) { wrap.appendChild(sourceButton(s)); });
      });
      line.appendChild(more);
    }
    return wrap;
  }

  /* -------------------------------------------------------------- render */

  var view = h('div', 'dnp-view dnp-root');
  view.setAttribute('data-modable', 'discord-notion-project-view');
  view.setAttribute('role', 'region');
  view.setAttribute('aria-label', 'Project from Discord');
  var scroll = h('div', 'dnp-scroll');
  var page = h('div', 'dnp-page');
  scroll.appendChild(page);
  view.appendChild(scroll);

  var count = 0;

  function heading(title, n) {
    var hd = h('div', 'dnp-h');
    hd.appendChild(h('span', null, title));
    if (n !== '') hd.appendChild(h('span', 'dnp-n', String(n)));
    page.appendChild(hd);
    return hd;
  }

  function item(kind, marker, build) {
    var row = mark(h('div', 'dnp-item dnp-k-' + kind), 'item');
    var mk = h('div', 'dnp-mk');
    if (marker) mk.appendChild(marker);
    row.appendChild(mk);
    var body = h('div', 'dnp-body');
    row.appendChild(body);
    build(body, row, mk);
    page.appendChild(row);
    count++;
    return row;
  }

  function withSources(body, sources) {
    var s = sourcesRow(sources);
    if (!s) return;
    var meta = h('div', 'dnp-meta');
    meta.appendChild(s);
    body.appendChild(meta);
  }

  function openTasks() {
    return P.tasks.filter(function (t) { return !mem.done[itemKey('task', t.text)]; }).length;
  }
  function taskCount() {
    var left = openTasks();
    return left === P.tasks.length ? String(left) : left + ' of ' + P.tasks.length + ' open';
  }

  function render() {
    page.textContent = '';
    count = 0;
    var o = P.origin;
    var where = (o.kind === 'ghost' ? 'Ghost Channel #' : '#') + (o.ghostLabel || o.channelName);

    var tools = h('div', 'dnp-tools');
    function tool(label, title, paths, fn) {
      var b = mark(h('button', 'dnp-tool'), 'tool');
      b.type = 'button'; b.title = title;
      b.appendChild(icon(paths, 15));
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', fn);
      tools.appendChild(b);
    }
    tool('Back to page', 'Show the Notion page', ['M15 6l-6 6 6 6'], function () { setOpen(false); });
    tool('Remove project', 'Take this project off the page', ['M5 7h14', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
      function () { teardown(); });
    page.appendChild(tools);

    var crumb = h('div', 'dnp-crumb');
    crumb.appendChild(icon(DISCORD, 14, null, true));
    if (o.serverName) { crumb.appendChild(h('span', null, o.serverName)); crumb.appendChild(h('span', 'dnp-sep', '/')); }
    crumb.appendChild(h('span', null, where));
    page.appendChild(crumb);

    page.appendChild(h('h1', 'dnp-title', P.title));

    var props = h('div', 'dnp-props');
    function prop(label, paths, fill) {
      var k = h('div', 'dnp-pk');
      k.appendChild(icon(paths, 16));
      k.appendChild(h('span', null, label));
      var v = h('div', 'dnp-pv');
      fill(v);
      props.appendChild(k); props.appendChild(v);
    }
    prop('Source', ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'], function (v) {
      var label = where + (o.serverName ? ' · ' + o.serverName : '');
      if (o.kind === 'channel' && o.channelId) {
        var b = sourceButton({ app: 'discord', serverId: o.serverId, channelId: o.channelId, channelName: o.channelName },
          label, 'Open #' + o.channelName + ' in Discord');
        b.classList.add('dnp-prime');
        v.appendChild(b);
      } else {
        v.appendChild(h('span', null, label));
      }
    });
    prop('Messages', ['M4 5h16v11H8l-4 4z'], function (v) {
      var a = fmtDay(o.firstAt), b = fmtDay(o.lastAt);
      v.textContent = o.messageCount + ' read' + (a ? ' · ' + (a === b ? a : a + ' – ' + b) : '');
    });
    prop('Status', ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8v4l2.5 2.5'], function (v) {
      var pill = h('span', 'dnp-pill');
      pill.appendChild(h('span', 'dnp-dot'));
      pill.appendChild(document.createTextNode('From Discord'));
      v.appendChild(pill);
      var when = fmtWhen(o.extractedAt);
      if (when) v.appendChild(h('span', 'dnp-faint', 'Read ' + when));
    });
    page.appendChild(props);
    page.appendChild(h('div', 'dnp-hr'));

    if (P.overview) {
      heading('Overview', '');
      page.appendChild(h('p', 'dnp-overview', P.overview));
    }

    if (P.tasks && P.tasks.length) {
      var taskHead = heading('Tasks', taskCount());
      P.tasks.forEach(function (t) {
        var k = itemKey('task', t.text);
        item('task', null, function (body, row, mk) {
          var box = mark(h('button', 'dnp-check'), 'check');
          box.type = 'button';
          box.setAttribute('role', 'checkbox');
          box.setAttribute('aria-label', 'Done');
          box.appendChild(icon(CHECK, 12));
          mk.appendChild(box);
          function paint() {
            var d = !!mem.done[k];
            box.setAttribute('aria-checked', d ? 'true' : 'false');
            row.classList.toggle('dnp-done', d);
            taskHead.lastChild.textContent = taskCount();
          }
          box.addEventListener('click', function () { mem.done[k] = !mem.done[k]; paint(); });
          body.appendChild(h('div', 'dnp-text', t.text));
          var meta = h('div', 'dnp-meta');
          if (t.owner) {
            var ow = h('span', 'dnp-owner', '@' + t.owner);
            ow.title = 'Named in the message';
            meta.appendChild(ow);
          }
          if (t.dueDate) {
            var du = h('span', 'dnp-due');
            du.appendChild(icon(['M5 6h14v14H5z', 'M5 10h14', 'M9 4v4', 'M15 4v4'], 13));
            du.appendChild(document.createTextNode(t.dueDate));
            du.title = 'As written in the message';
            meta.appendChild(du);
          }
          var s = sourcesRow(t.sources);
          if (s) meta.appendChild(s);
          body.appendChild(meta);
          paint();
        });
      });
    }

    function plainSection(title, list, kind, marker) {
      if (!list || !list.length) return;
      heading(title, list.length);
      list.forEach(function (it) {
        item(kind, marker(), function (body) {
          body.appendChild(h('div', 'dnp-text', it.text));
          withSources(body, it.sources);
        });
      });
    }
    plainSection('Decisions', P.decisions, 'dec', function () { return icon(CHECK, 15); });
    plainSection('Blockers', P.blockers, 'blk', function () { return h('span', 'dnp-bul'); });
    plainSection('Open Questions', P.questions, 'q', function () { return document.createTextNode('?'); });

    if (P.resources && P.resources.length) {
      heading('Resources', P.resources.length);
      P.resources.forEach(function (r) {
        item('res', icon(['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'], 16),
          function (body) {
            var line = h('div', 'dnp-res');
            var url = safeUrl(r.url);
            if (url) {
              var a = mark(h('a', null, r.title || url), 'link');
              a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
              line.appendChild(a);
              var d = domain(url);
              if (d && (r.title || '') !== url) line.appendChild(h('span', 'dnp-dom', d));
            } else {
              line.appendChild(h('span', 'dnp-text', r.title));
            }
            body.appendChild(line);
            withSources(body, r.sources);
          });
      });
    }

    page.appendChild(h('div', 'dnp-foot',
      'Built by Modable from ' + o.messageCount + ' Discord message' + (o.messageCount === 1 ? '' : 's') +
      '. Shown over this page only — nothing here is saved to Notion or posted to Discord.'));
  }

  render();
  document.body.appendChild(view);

  /* -------------------------------------------------------------- switch */

  var sw = h('div', 'dnp-switch dnp-root');
  sw.setAttribute('data-modable', 'discord-notion-project-switch');
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', 'Page or project');
  function seg(label, paths, fill, value) {
    var b = h('button', 'dnp-seg');
    b.type = 'button';
    if (paths) b.appendChild(icon(paths, 13, null, fill));
    b.appendChild(document.createTextNode(label));
    b.addEventListener('click', function () { setOpen(value); });
    sw.appendChild(b);
    return b;
  }
  var segPage = seg('Page', null, false, false);
  var segProject = seg('Project', DISCORD, true, true);

  function placeSwitch() {
    var buttons = document.querySelector('.notion-topbar-action-buttons');
    if (!buttons) return false;
    var share = buttons.querySelector('[aria-label="Share"]');
    if (share) {
      var it = share;
      while (it.parentElement && it.parentElement !== buttons && it.parentElement.children.length === 1) it = it.parentElement;
      if (it.parentElement && it.parentElement !== buttons) { it.parentElement.insertBefore(sw, it); return true; }
    }
    buttons.insertBefore(sw, buttons.firstChild);
    return true;
  }
  if (!placeSwitch()) {
    style.remove(); view.remove();
    return { ok: false, reason: 'no place for the Project switch' };
  }

  /* ------------------------------------------------------------- layout */

  function position() {
    var f = frameEl();
    if (!f) return;
    var r = f.getBoundingClientRect();
    view.style.left = r.left + 'px';
    view.style.top = r.top + 'px';
    view.style.width = r.width + 'px';
    view.style.height = r.height + 'px';
  }

  function setOpen(v) {
    open = !!v;
    mem.open = open;
    segPage.setAttribute('aria-pressed', open ? 'false' : 'true');
    segProject.setAttribute('aria-pressed', open ? 'true' : 'false');
    var here = location.pathname === home;
    var was = !view.hidden;
    view.hidden = !(open && here);
    if (open && here) {
      position();
      if (!was && !reduced) {
        view.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
        page.animate([{ transform: 'translateY(6px)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
  }

  var ro = new ResizeObserver(position);
  ro.observe(frameEl());
  cleanups.push(function () { ro.disconnect(); });
  window.addEventListener('resize', position);
  cleanups.push(function () { window.removeEventListener('resize', position); });

  // The project belongs to the page it was put on. Notion re-renders the
  // topbar on navigation: the switch only lives on this page, and the view
  // steps aside while another page is showing, then comes back with it.
  var href = location.href;
  var watched = frameEl();
  var mo = new MutationObserver(function () {
    var here = location.pathname === home;
    if (location.href !== href) {
      href = location.href;
      view.hidden = !(open && here);
      if (!view.hidden) position();
    }
    if (here && !sw.isConnected) placeSwitch();
    if (!here && sw.isConnected) sw.remove();
    var f = frameEl();
    if (f && f !== watched) { ro.disconnect(); ro.observe(f); watched = f; position(); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  cleanups.push(function () { mo.disconnect(); });

  function onKey(e) {
    if (e.key === 'Escape' && open && !view.hidden && view.contains(document.activeElement)) { e.stopPropagation(); setOpen(false); }
  }
  document.addEventListener('keydown', onKey, true);
  cleanups.push(function () { document.removeEventListener('keydown', onKey, true); });

  /* ------------------------------------------------------------ teardown */

  function teardown(opts) {
    cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
    cleanups = [];
    Object.keys(pending).forEach(function (k) { delete pending[k]; });
    if (window.__modableSourceAck === onAck) delete window.__modableSourceAck;
    document.querySelectorAll('[data-modable^="discord-notion-project"]').forEach(function (n) { n.remove(); });
    // A re-run keeps what was ticked; removing the project leaves nothing.
    if (!(opts && opts.keep)) delete window.__modableDiscordProject;
    if (hooks[KEY] === teardown) delete hooks[KEY];
  }
  hooks[KEY] = teardown;

  view.hidden = true;
  setOpen(mem.open !== false);
  return { ok: true, items: count };
})(/*MODABLE_CONFIG*/null);
