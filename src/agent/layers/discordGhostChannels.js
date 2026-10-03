/*
 * Discord Ghost Channels — a Modable layer for the Discord desktop app.
 *
 * Adds a GENERATED section to the server's channel list holding local
 * channels Modable made from a request ("make me a channel with everything
 * about AI agents and LLMs"). Opening one reads the server's matching text
 * channels through Discord's own navigation, keeps the real messages that are
 * about the topic, and lists them the way Discord lists messages — each with
 * the channel it came from and a link back to the original.
 *
 * Nothing is posted, created or changed on the server. The channels live in
 * this window's memory; the messages are re-read from Discord when opened.
 *
 * What the live renderer offers, and so what this uses:
 *   nav[aria-label$="(server)"] ul[aria-label="Channels"]   the channel list
 *     (virtualised; its scroller is the ul's parent, where the section goes)
 *   a[data-list-item-id="channels___<id>"][aria-label]       a channel, with
 *     its kind in the label: "name (text channel)"
 *   /channels/<guild>/<channel>[/<message>]                  Discord's own
 *     routes, reached through history + popstate — the message route loads
 *     the history around a message and highlights it, as message links do
 *   li[id^="chat-messages-<channel>-"]                       a rendered message
 *   #message-content-<id> #message-username-<id> #message-timestamp-<id>
 *   #message-reply-context-<id>
 *   section[aria-label="Channel header"], main[aria-label$="(channel)"]
 * Discord's message and channel stores are not reachable without running its
 * internal module factories, so they are not used.
 *
 * Relevance: the request was read once on Modable's side into concepts (the
 * words and names a message on the topic would contain). Here each real
 * message is scored by which concepts it mentions, with a small lift for
 * messages from a channel whose name matches. The matched concepts are shown
 * on every result. No message is rewritten or invented.
 *
 * Only the stylesheet and the section are claimed marks, because they are the
 * only nodes that exist straight after injection. Everything else is tagged
 * through mark() so it is not mistaken for proof the layer took.
 */
(function (CONFIG) {
  var KEY = 'discord-ghost-channel';
  var ATTR = 'data-modable';
  var hooks = (window.__modableTeardown = window.__modableTeardown || {});

  // Injecting again replaces this layer but keeps the channels already made,
  // so a second request adds a second channel instead of stacking a copy.
  if (hooks[KEY]) { try { hooks[KEY]({ keep: true }); } catch (e) {} }
  document.querySelectorAll('[data-modable^="discord-ghost-channel"]').forEach(function (n) { n.remove(); });
  var registry = window.__modableGhostChannels = window.__modableGhostChannels || { channels: [], catalogs: {} };

  function navEl() { return document.querySelector('nav[aria-label$="(server)"]'); }
  function listEl() { var n = navEl(); return n && n.querySelector('ul[aria-label="Channels"]'); }
  function headerEl() { return document.querySelector('section[aria-label="Channel header"]'); }
  function chatEl() { return document.querySelector('main[aria-label$="(channel)"]'); }
  function guildId() { var g = location.pathname.split('/')[2]; return /^\d+$/.test(g || '') ? g : ''; }

  if (!CONFIG || !CONFIG.label || !CONFIG.concepts || !CONFIG.concepts.length) {
    return { ok: false, reason: 'no topic was given for the Ghost Channel' };
  }
  if (!navEl() || !listEl() || !guildId()) {
    return { ok: false, reason: 'Discord server channel list not found — open a server first' };
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cleanups = [];
  var view = null;       // the open Ghost Channel view, if any
  var navigating = 0;    // >0 while this layer is moving Discord between channels
  var backPill = null;

  function mark(el, part) { el.setAttribute(ATTR, KEY + '-' + part); return el; }
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function svg(paths, size, extra) {
    var el = document.createElementNS(NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('width', size); el.setAttribute('height', size);
    el.setAttribute('fill', 'none');
    el.setAttribute('aria-hidden', 'true');
    paths.forEach(function (p) {
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', p.d || p);
      path.setAttribute(p.fill ? 'fill' : 'stroke', 'currentColor');
      if (!p.fill) { path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); }
      el.appendChild(path);
    });
    if (extra) el.setAttribute('class', extra);
    return el;
  }
  var HASH = ['M10 3 7.5 21', 'M16.5 3 14 21', 'M4 8.5h16.5', 'M3 15.5h16.5'];
  var SPARK = { d: 'M12 2.5c.5 3.9 1.6 5 5.5 5.5-3.9.5-5 1.6-5.5 5.5-.5-3.9-1.6-5-5.5-5.5 3.9-.5 5-1.6 5.5-5.5Z', fill: true };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function waitFor(test, timeout, every) {
    for (var t = 0; t < timeout; t += (every || 150)) {
      var v = test();
      if (v) return v;
      await sleep(every || 150);
    }
    return test();
  }

  /* ---------------------------------------------------------------- style */

  var style = document.createElement('style');
  style.setAttribute('data-modable', 'discord-ghost-channel-style');
  style.textContent = [
    '.dgc-root{--dgc-fg:var(--text-default,#dbdee1);--dgc-strong:var(--text-strong,#fbfbfb);--dgc-mute:var(--text-muted,#949ba4);',
    ' --dgc-ch:var(--channels-default,#949ba4);--dgc-bg:var(--chat-background-default,var(--background-base-lower,#1a1a1e));',
    ' --dgc-hover:var(--background-mod-subtle,rgba(151,151,159,.12));--dgc-sel:color-mix(in oklab,var(--dgc-fg) 13%,transparent);',
    ' --dgc-line:var(--border-subtle,rgba(151,151,159,.2));--dgc-accent:var(--brand-500,#5865f2);--dgc-link:var(--text-link,#00a8fc);',
    ' font-family:var(--font-primary,"gg sans","Noto Sans",sans-serif)}',

    /* sidebar */
    '.dgc-section{padding:4px 0 12px;overflow:hidden;list-style:none}',
    '.dgc-cat{display:flex;align-items:center;gap:6px;height:24px;padding:0 8px 0 16px;font-size:14px;font-weight:500;line-height:18px;',
    ' color:var(--dgc-ch);cursor:default;user-select:none}',
    '.dgc-cat svg{color:var(--dgc-accent);opacity:.85;flex:none}',
    '.dgc-cat span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dgc-row{display:flex;align-items:center;gap:6px;height:32px;margin:1px 0 1px 8px;padding:4px 8px;border-radius:8px;box-sizing:border-box;',
    ' color:var(--dgc-ch);cursor:pointer;user-select:none;outline:none}',
    '.dgc-row:hover{background:var(--dgc-hover);color:var(--dgc-fg)}',
    '.dgc-row:focus-visible{box-shadow:inset 0 0 0 2px var(--focus-primary,#00b0f4)}',
    '.dgc-row.dgc-on{background:var(--dgc-sel);color:var(--dgc-strong)}',
    '.dgc-icon{position:relative;width:20px;height:20px;flex:none;color:var(--dgc-ch)}',
    '.dgc-row:hover .dgc-icon,.dgc-row.dgc-on .dgc-icon{color:currentColor}',
    '.dgc-icon .dgc-spark{position:absolute;right:-3px;top:-3px;color:var(--dgc-accent)}',
    '.dgc-name{flex:1;min-width:0;font-size:16px;font-weight:500;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dgc-new{animation:dgc-resolve .7s cubic-bezier(.2,.8,.2,1) both}',
    '@keyframes dgc-resolve{0%{opacity:0;transform:translateX(-6px);filter:blur(2px)}60%{filter:none}100%{opacity:1;transform:none}}',
    '.dgc-new .dgc-spark{animation:dgc-spark 1.1s ease-out .25s both}',
    '@keyframes dgc-spark{0%{transform:scale(0) rotate(-40deg);opacity:0}50%{transform:scale(1.35);opacity:1}100%{transform:none;opacity:1}}',

    /* view */
    '.dgc-view{position:fixed;z-index:101;display:flex;flex-direction:column;background:var(--dgc-bg);color:var(--dgc-fg);overflow:hidden;',
    ' -webkit-font-smoothing:antialiased}',
    '.dgc-head{flex:none;display:flex;align-items:center;gap:8px;height:48px;padding:0 8px 0 16px;box-sizing:border-box;',
    ' border-bottom:1px solid var(--dgc-line)}',
    '.dgc-head .dgc-icon{width:24px;height:24px;color:var(--dgc-mute)}',
    '.dgc-title{font-size:16px;font-weight:600;line-height:20px;color:var(--dgc-strong);white-space:nowrap}',
    '.dgc-divider{width:1px;height:24px;background:var(--dgc-line);margin:0 4px;flex:none}',
    '.dgc-topic{flex:1;min-width:0;font-size:14px;color:var(--dgc-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dgc-act{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;',
    ' color:var(--dgc-mute);font:inherit;font-size:14px;font-weight:500;cursor:pointer;white-space:nowrap}',
    '.dgc-act:hover{background:var(--dgc-hover);color:var(--dgc-fg)}',
    '.dgc-act:focus-visible{outline:2px solid var(--focus-primary,#00b0f4)}',
    '.dgc-act.dgc-danger:hover{color:var(--status-danger,#f23f43)}',
    '.dgc-scroll{flex:1;overflow-y:auto;overflow-x:hidden;padding-bottom:24px}',

    '.dgc-welcome{padding:16px 16px 8px 16px;margin:16px 0 8px}',
    '.dgc-badge{width:68px;height:68px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
    ' background:color-mix(in oklab,var(--dgc-fg) 9%,transparent);color:var(--dgc-strong);position:relative;margin-bottom:8px}',
    '.dgc-badge .dgc-spark{position:absolute;right:6px;top:6px;color:var(--dgc-accent)}',
    '.dgc-welcome h1{margin:8px 0;font-size:32px;line-height:40px;font-weight:700;color:var(--dgc-strong);letter-spacing:-.01em}',
    '.dgc-welcome p{margin:0;font-size:16px;line-height:22px;color:var(--dgc-mute);max-width:720px}',
    '.dgc-welcome b{font-weight:500;color:var(--dgc-fg)}',
    '.dgc-concepts{display:flex;flex-wrap:wrap;gap:4px;margin-top:12px;max-width:720px}',
    '.dgc-chip{padding:2px 8px;border-radius:12px;background:var(--dgc-hover);font-size:12px;line-height:18px;color:var(--dgc-mute)}',
    '.dgc-sep{display:flex;align-items:center;gap:8px;margin:16px 16px 8px;font-size:12px;font-weight:600;color:var(--dgc-mute)}',
    '.dgc-sep::before,.dgc-sep::after{content:"";flex:1;height:1px;background:var(--dgc-line)}',

    '.dgc-msg{position:relative;display:flex;gap:16px;padding:8px 48px 8px 16px;margin-top:2px}',
    '.dgc-msg:hover{background:color-mix(in oklab,var(--dgc-fg) 3%,transparent)}',
    '.dgc-av{width:40px;height:40px;border-radius:50%;flex:none;object-fit:cover;background:var(--dgc-hover);margin-top:2px}',
    '.dgc-body{min-width:0;flex:1}',
    '.dgc-reply{margin:-2px 0 2px;font-size:14px;line-height:18px;color:var(--dgc-mute);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}',
    '.dgc-reply b{font-weight:500;color:var(--dgc-fg);opacity:.8}',
    '.dgc-mh{display:flex;align-items:baseline;gap:8px;line-height:22px}',
    '.dgc-author{font-size:16px;font-weight:500;color:var(--dgc-strong)}',
    '.dgc-time{font-size:12px;color:var(--dgc-mute)}',
    '.dgc-text{font-size:16px;line-height:22px;color:var(--dgc-fg);white-space:pre-wrap;overflow-wrap:anywhere;',
    ' display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}',
    '.dgc-text mark{background:color-mix(in oklab,var(--dgc-accent) 22%,transparent);color:inherit;border-radius:3px;padding:0 1px}',
    '.dgc-foot{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:12px;line-height:16px;color:var(--dgc-mute)}',
    '.dgc-src{display:inline-flex;align-items:center;gap:2px;padding:1px 6px 1px 3px;border-radius:4px;background:var(--dgc-hover);',
    ' color:var(--dgc-fg);font-weight:500;cursor:pointer}',
    '.dgc-src:hover{background:color-mix(in oklab,var(--dgc-fg) 18%,transparent)}',
    '.dgc-why{opacity:.8}',
    '.dgc-open{margin-left:auto;border:0;background:none;padding:2px 4px;border-radius:4px;color:var(--dgc-link);font:inherit;font-size:13px;',
    ' font-weight:500;cursor:pointer;opacity:.75}',
    '.dgc-msg:hover .dgc-open{opacity:1}',
    '.dgc-open:hover{text-decoration:underline}',
    '.dgc-open:focus-visible{outline:2px solid var(--focus-primary,#00b0f4)}',
    '.dgc-empty{margin:24px 16px;font-size:15px;color:var(--dgc-mute)}',

    /* reading */
    '.dgc-reading{margin:4px 16px 0;max-width:520px}',
    '.dgc-step{display:flex;align-items:center;gap:10px;height:30px;font-size:14px;color:var(--dgc-mute);transition:color .2s}',
    '.dgc-step i{width:14px;height:14px;border-radius:50%;flex:none;box-sizing:border-box;border:2px solid var(--dgc-line)}',
    '.dgc-step.dgc-active{color:var(--dgc-fg)}',
    '.dgc-step.dgc-active i{border-color:var(--dgc-accent);border-right-color:transparent;animation:dgc-spin .8s linear infinite}',
    '.dgc-step.dgc-done i{border:0;background:var(--dgc-accent)}',
    '.dgc-step.dgc-done{color:var(--dgc-fg)}',
    '.dgc-step em{margin-left:auto;font-style:normal;font-size:12px;color:var(--dgc-mute);font-variant-numeric:tabular-nums}',
    '@keyframes dgc-spin{to{transform:rotate(360deg)}}',
    '.dgc-arrive{animation:dgc-arrive .42s cubic-bezier(.2,.8,.2,1) both}',
    '@keyframes dgc-arrive{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',

    /* sources */
    '.dgc-pop{position:absolute;z-index:2;right:8px;top:52px;width:300px;max-height:min(460px,calc(100% - 70px));display:flex;flex-direction:column;',
    ' border-radius:8px;background:var(--background-surface-high,var(--background-base-low,#232428));box-shadow:0 0 0 1px var(--dgc-line),0 8px 24px rgba(0,0,0,.3)}',
    '.dgc-pop h3{margin:0;padding:12px 12px 4px;font-size:12px;font-weight:600;color:var(--dgc-mute);text-transform:uppercase;letter-spacing:.02em}',
    '.dgc-pop p{margin:0;padding:0 12px 8px;font-size:12px;color:var(--dgc-mute)}',
    '.dgc-list{flex:1;overflow-y:auto;padding:0 6px}',
    '.dgc-opt{display:flex;align-items:center;gap:8px;height:30px;padding:0 6px;border-radius:4px;font-size:14px;color:var(--dgc-fg);cursor:pointer}',
    '.dgc-opt:hover{background:var(--dgc-hover)}',
    '.dgc-opt input{accent-color:var(--dgc-accent);margin:0}',
    '.dgc-opt span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dgc-opt em{font-style:normal;font-size:11px;color:var(--dgc-accent)}',
    '.dgc-popfoot{display:flex;justify-content:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--dgc-line)}',
    '.dgc-btn{height:32px;padding:0 14px;border:0;border-radius:8px;font:inherit;font-size:14px;font-weight:500;cursor:pointer;',
    ' background:var(--dgc-accent);color:#fff}',
    '.dgc-btn.dgc-quiet{background:transparent;color:var(--dgc-fg)}',
    '.dgc-btn.dgc-quiet:hover{text-decoration:underline}',

    '.dgc-pill{position:fixed;z-index:89;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px 0 10px;border:0;border-radius:16px;',
    ' background:var(--background-surface-high,#2b2d31);color:var(--dgc-fg);font:inherit;font-size:14px;font-weight:500;cursor:pointer;',
    ' box-shadow:0 0 0 1px var(--dgc-line),0 6px 16px rgba(0,0,0,.25);animation:dgc-arrive .3s ease-out both}',
    '.dgc-pill:hover{color:var(--dgc-strong)}',
    '.dgc-pill .dgc-spark{color:var(--dgc-accent)}',
  ].join('\n');
  document.head.appendChild(style);

  /* ------------------------------------------------------------- registry */

  var guild = guildId();
  var fresh = {
    id: 'g' + guild + '-' + CONFIG.label,
    guild: guild,
    label: String(CONFIG.label),
    topic: String(CONFIG.topic || CONFIG.label),
    prompt: String(CONFIG.prompt || ''),
    concepts: CONFIG.concepts.map(function (c) { return { term: String(c.term).toLowerCase(), weight: +c.weight || 2 }; }),
    understoodBy: CONFIG.understoodBy === 'model' ? 'model' : 'prompt',
    sources: null, results: null, readAt: 0, isNew: true,
  };
  registry.channels = registry.channels.filter(function (c) { return c.id !== fresh.id; });
  registry.channels.push(fresh);

  function channelsHere() { var g = guildId(); return registry.channels.filter(function (c) { return c.guild === g; }); }

  /* -------------------------------------------------------------- sidebar */

  var section = document.createElement('div');
  section.setAttribute('data-modable', 'discord-ghost-channel-section');
  section.className = 'dgc-section dgc-root';
  section.setAttribute('role', 'group');
  section.setAttribute('aria-label', 'Generated channels');

  function renderSection() {
    var here = channelsHere();
    section.textContent = '';
    section.style.display = here.length ? '' : 'none';
    var cat = h('div', 'dgc-cat');
    cat.appendChild(svg([SPARK], 12));
    cat.appendChild(h('span', null, 'Generated'));
    cat.title = 'Channels generated locally by Modable — not on the server';
    section.appendChild(cat);
    here.forEach(function (c) {
      var row = mark(h('div', 'dgc-row'), 'row');
      row.tabIndex = 0;
      row.setAttribute('role', 'link');
      row.setAttribute('data-ghost', c.id);
      row.setAttribute('aria-label', c.label + ' (generated channel)');
      row.title = 'Generated locally by Modable · ' + c.topic;
      var ic = h('span', 'dgc-icon');
      ic.appendChild(svg(HASH, 20));
      ic.appendChild(svg([SPARK], 10, 'dgc-spark'));
      row.appendChild(ic);
      row.appendChild(h('span', 'dgc-name', c.label));
      if (view && view.ch === c) row.classList.add('dgc-on');
      if (c.isNew && !reduced) { row.classList.add('dgc-new'); c.isNew = false; }
      row.addEventListener('click', function () { openGhost(c); });
      row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGhost(c); } });
      section.appendChild(row);
    });
  }

  // First thing in the channel list, after the spacers Discord keeps under
  // the server banner and before its first row, so it scrolls with the
  // channels and sits where a category would. Those leading rows stay
  // mounted however far the list is scrolled.
  function placeSection() {
    var ul = listEl();
    if (!ul) return false;
    var first = ul.firstElementChild;
    while (first && (first === section || first.tagName !== 'LI')) first = first.nextElementSibling;
    if (!first) return false;
    if (section.parentElement !== ul || section.nextElementSibling !== first) ul.insertBefore(section, first);
    // Discord sizes the list to its own rows, so the section's height is
    // given back after the list; otherwise the last rows fall off the end.
    if (ul.parentElement && (spacer.parentElement !== ul.parentElement || spacer.previousElementSibling !== ul)) ul.after(spacer);
    spacer.style.height = section.offsetHeight + 'px';
    return true;
  }
  var spacer = document.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  mark(spacer, 'spacer');
  var sizeRo = new ResizeObserver(function () { spacer.style.height = section.offsetHeight + 'px'; });
  sizeRo.observe(section);
  cleanups.push(function () { sizeRo.disconnect(); spacer.remove(); });

  renderSection();
  if (!placeSection()) { style.remove(); return { ok: false, reason: 'no place for the Generated section' }; }
  if (!reduced) section.animate([{ maxHeight: '0px', opacity: 0 }, { maxHeight: '200px', opacity: 1 }],
    { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });

  // Discord re-renders the list when the server changes or the list
  // re-virtualises. Put the section back, re-scoped to the server shown, and
  // notice when the user leaves for a real channel. Watches the server nav's
  // layer only, once a frame at most.
  var lastGuild = guild;
  var lastPath = location.pathname;
  var queued = false;
  function onChange() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      var g = guildId();
      if (g !== lastGuild) { lastGuild = g; renderSection(); if (view) closeGhost(true); }
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        if (!navigating && view && !view.reading) closeGhost(true);
        if (!navigating && backPill && location.pathname.split('/')[3] !== backPill.channel) dropPill();
      }
      if (navEl()) placeSection();
    });
  }
  var mo = new MutationObserver(onChange);
  var watchRoot = (navEl() && navEl().parentElement) || document.body;
  mo.observe(watchRoot, { childList: true, subtree: true });
  cleanups.push(function () { mo.disconnect(); });
  window.addEventListener('popstate', onChange);
  cleanups.push(function () { window.removeEventListener('popstate', onChange); });

  // Clicking a real channel while a Ghost Channel is open goes to it, even
  // the one Discord still has selected underneath.
  function onNavClick(e) {
    if (!view || navigating) return;
    var a = e.target.closest && e.target.closest('a[href^="/channels/"]');
    if (a) closeGhost(true);
  }
  document.addEventListener('click', onNavClick, true);
  cleanups.push(function () { document.removeEventListener('click', onNavClick, true); });

  /* ------------------------------------------------------- reading Discord */

  // Discord's own routes: its router follows history like a message link.
  async function route(path) {
    if (location.pathname === path) return;
    navigating++;
    try {
      history.pushState(history.state, '', path);
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      await sleep(50);
    } finally { navigating--; }
  }

  // Every text and announcement channel the user can see. Discord hands its
  // channel list a model of the whole server (guildChannels) as a prop; that
  // is read as plain data — no methods called. Channels the user cannot see
  // are "___hidden___" placeholders there and are skipped.
  function catalogFromList() {
    var ul = listEl();
    var fk = ul && Object.keys(ul).filter(function (k) { return k.indexOf('__reactFiber') === 0; })[0];
    var gc = null;
    for (var f = fk && ul[fk], i = 0; f && i < 40 && !gc; f = f.return, i++) {
      var p = f.memoizedProps;
      if (p && p.guildChannels && p.guildChannels.categories) gc = p.guildChannels;
    }
    if (!gc) return null;
    var out = [];
    var seen = {};
    Object.keys(gc.categories).forEach(function (k) {
      var chs = gc.categories[k] && gc.categories[k].channels;
      if (!chs) return;
      Object.keys(chs).forEach(function (id) {
        var r = chs[id] && chs[id].record;
        if (!r || seen[r.id] || (r.type !== 0 && r.type !== 5) || !r.name || r.name === '___hidden___') return;
        seen[r.id] = 1;
        out.push({ id: String(r.id), name: String(r.name), kind: r.type === 5 ? 'announcement' : 'text', pos: chs[id].position || 0 });
      });
    });
    return out.length ? out : null;
  }

  // Fallback: the list only renders what is on screen, so it is walked once
  // and put back where it was.
  async function catalog() {
    var g = guildId();
    if (registry.catalogs[g]) return registry.catalogs[g];
    var known = catalogFromList();
    if (known) { registry.catalogs[g] = known; return known; }
    var ul = listEl();
    var sc = ul && ul.parentElement;
    var found = {};
    var order = [];
    function collect() {
      var n = navEl();
      if (!n) return;
      n.querySelectorAll('a[data-list-item-id^="channels___"]').forEach(function (a) {
        var id = a.getAttribute('data-list-item-id').slice(11);
        var label = a.getAttribute('aria-label') || '';
        var m = label.match(/^(?:unread, )?(?:\d+ mentions?, )?(.*) \((text|announcement) channel\)$/);
        if (!m || found[id]) return;
        found[id] = { id: id, name: m[1], kind: m[2] };
        order.push(found[id]);
      });
    }
    if (sc) {
      var keep = sc.scrollTop;
      navigating++;
      try {
        for (var y = 0; y <= sc.scrollHeight; y += Math.max(200, sc.clientHeight - 80)) {
          sc.scrollTop = y;
          await sleep(60);
          collect();
        }
      } finally { sc.scrollTop = keep; navigating--; }
    }
    collect();
    registry.catalogs[g] = order;
    return order;
  }

  // Concepts as patterns: whole words, a plural or verb ending allowed, and
  // "tool use" matching "tool-use" too.
  function patterns(ch) {
    return ch.concepts.map(function (c) {
      var esc = c.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]+');
      var tail = c.term.length <= 3 ? '(?:s)?' : '(?:s|es|ed|ing|ic|ers?)?';
      return { term: c.term, weight: c.weight, re: new RegExp('(^|[^a-z0-9])(' + esc + tail + ')(?![a-z0-9])', 'gi') };
    });
  }
  // Channel names abbreviate ("algos-and-data-structs"), so a name word
  // counts for a concept word when they share a start of four letters or
  // more; a phrase concept needs every one of its words.
  function nameMatches(name, pats) {
    var toks = name.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean);
    function word(w) {
      return toks.some(function (t) {
        if (t === w || t === w + 's' || w === t + 's') return true;
        var cp = 0;
        while (cp < t.length && cp < w.length && t[cp] === w[cp]) cp++;
        return cp >= 4 && cp >= Math.min(t.length, w.length) - 1;
      });
    }
    return pats.filter(function (p) { return p.term.split(' ').every(word); });
  }

  // The sources a channel starts with: the channels whose names say they are
  // about the topic, then the one the user is in.
  function defaultSources(ch, cat) {
    var pats = patterns(ch);
    var scored = cat.map(function (c) {
      return { c: c, s: nameMatches(c.name, pats).reduce(function (n, p) { return n + p.weight; }, 0) };
    }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; });
    var picked = scored.slice(0, 4).map(function (x) { return x.c.id; });
    var here = location.pathname.split('/')[3];
    if (here && picked.indexOf(here) < 0 && cat.some(function (c) { return c.id === here; })) picked.push(here);
    return picked.slice(0, 5);
  }

  function messageScroller() {
    var ol = document.querySelector('ol[data-list-id="chat-messages"]');
    var sc = ol && ol.parentElement;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    return sc;
  }

  function cleanText(node) {
    if (!node) return '';
    var c = node.cloneNode(true);
    c.querySelectorAll('time').forEach(function (x) { (x.closest('[class^="timestamp"]') || x).remove(); });
    c.querySelectorAll('[aria-hidden="true"]').forEach(function (x) { x.remove(); });
    return (c.innerText || c.textContent || '').replace(/ /g, ' ').replace(/[​-‍⁠﻿]/g, '')
      .replace(/\s*\(edited\)\s*$/, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  function readChannel(src) {
    var out = [];
    var prev = null;
    var avatars = {};
    document.querySelectorAll('li[id^="chat-messages-' + src.id + '-"]').forEach(function (li) {
      var id = li.id.split('-').pop();
      if (!/^\d+$/.test(id)) return;
      var userEl = document.getElementById('message-username-' + id);
      var named = userEl && userEl.querySelector('[data-text]');
      var author = named ? named.getAttribute('data-text') : '';
      var bot = !!(userEl && userEl.parentElement && /\bAPP\b/.test(userEl.parentElement.innerText));
      if (!author && prev) { author = prev.author; bot = prev.bot; }
      var av = li.querySelector('img[class^="avatar"]');
      if (author && av && !avatars[author]) avatars[author] = av.getAttribute('src');
      var stamp = document.getElementById('message-timestamp-' + id);
      var t = stamp ? Date.parse(stamp.getAttribute('datetime')) : NaN;
      var rc = document.getElementById('message-reply-context-' + id);
      var refName = rc && rc.querySelector('[data-text]');
      var ref = rc && rc.querySelector('[id^="message-content-"]');
      var msg = {
        id: id, channel: src.id, source: src.name, author: author || 'Unknown', bot: bot,
        text: cleanText(document.getElementById('message-content-' + id)),
        t: isNaN(t) ? (prev ? prev.t : 0) : t,
        replyName: refName ? refName.getAttribute('data-text').replace(/^@/, '') : '',
        replyText: ref ? cleanText(ref) : '',
      };
      out.push(msg);
      prev = msg;
    });
    out.forEach(function (m) { m.avatar = avatars[m.author] || ''; });
    return out;
  }

  var PAGES = 2; // Discord's own scroll-back pages per source, ~20 messages each

  // Visit each source the way a person would: open it, scroll back a little,
  // read what rendered. Then go back to where the user was.
  async function gather(ch, ui) {
    var origin = location.pathname;
    var cat = await catalog();
    if (!ch.sources) ch.sources = defaultSources(ch, cat);
    var srcs = ch.sources.map(function (id) { return cat.filter(function (c) { return c.id === id; })[0]; }).filter(Boolean);
    ui.plan(srcs);
    var all = [];
    navigating++;
    try {
      for (var i = 0; i < srcs.length; i++) {
        if (ui.cancelled()) break;
        var src = srcs[i];
        ui.step(i, 'active');
        await route('/channels/' + ch.guild + '/' + src.id);
        var sel = 'li[id^="chat-messages-' + src.id + '-"]';
        var last = -1, stable = 0;
        await waitFor(function () {
          var n = document.querySelectorAll(sel).length;
          if (n > 0 && n === last) stable++; else stable = 0;
          last = n;
          return stable >= 2;
        }, 9000, 200);
        var sc = messageScroller();
        for (var p = 0; p < PAGES && sc && !ui.cancelled(); p++) {
          var before = document.querySelectorAll(sel).length;
          sc.scrollTop = 0;
          var grew = await waitFor(function () { return document.querySelectorAll(sel).length > before; }, 3500, 200);
          if (!grew) break;
          await sleep(250);
        }
        var got = readChannel(src);
        if (sc) sc.scrollTop = sc.scrollHeight;
        all = all.concat(got);
        ui.step(i, 'done', got.length);
      }
    } finally {
      await route(origin);
      navigating--;
    }
    ch.readAt = Date.now();
    ch.read = { channels: srcs, messages: all.length };
    ch.results = rank(ch, all, srcs);
    return ch.results;
  }

  function rank(ch, all, srcs) {
    var pats = patterns(ch);
    var lift = {};
    srcs.forEach(function (s) { lift[s.id] = nameMatches(s.name, pats).length ? 1 : 0; });
    var seen = {};
    var out = [];
    var need = ch.understoodBy === 'model' ? 3 : 2;
    all.forEach(function (m) {
      if (m.bot || m.text.length < 8) return;
      var key = m.text.toLowerCase().replace(/\W+/g, ' ').trim();
      if (seen[key]) return;
      var hits = [];
      var score = 0;
      pats.forEach(function (p) {
        p.re.lastIndex = 0;
        var found = 0;
        while (p.re.exec(m.text)) found++;
        if (found) { hits.push(p.term); score += p.weight + Math.min(found - 1, 2) * 0.25; }
      });
      if (!hits.length) return;
      score += lift[m.channel] || 0;
      if (score < need) return;
      seen[key] = 1;
      out.push({ m: m, score: score, hits: hits });
    });
    out.sort(function (a, b) { return b.score - a.score || b.m.t - a.m.t; });
    return out.slice(0, 80);
  }

  /* ----------------------------------------------------------------- view */

  function areaRect() {
    var hdr = headerEl(), chat = chatEl();
    if (!hdr || !chat) return null;
    var a = hdr.getBoundingClientRect(), b = chat.getBoundingClientRect();
    return { left: Math.min(a.left, b.left), top: a.top, width: Math.max(a.right, b.right) - Math.min(a.left, b.left), height: b.bottom - a.top };
  }
  function positionView() {
    if (!view) return;
    var r = areaRect();
    if (!r) return;
    var s = view.el.style;
    s.left = r.left + 'px'; s.top = r.top + 'px'; s.width = r.width + 'px'; s.height = r.height + 'px';
  }

  function fmtWhen(t) {
    var d = new Date(t), now = new Date();
    var time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return 'Today at ' + time;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday at ' + time;
    return d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' }) + ', ' + time;
  }
  function names(list) {
    var n = list.map(function (s) { return '#' + s.name; });
    return n.length <= 3 ? n.join(', ') : n.slice(0, 3).join(', ') + ' and ' + (n.length - 3) + ' more';
  }

  // The message text with the words that placed it marked. Text nodes only:
  // nothing from Discord is ever written back as HTML.
  function marked(text, hits, ch) {
    var el = h('div', 'dgc-text');
    var spans = [];
    patterns(ch).filter(function (p) { return hits.indexOf(p.term) >= 0; }).forEach(function (p) {
      p.re.lastIndex = 0;
      var m;
      while ((m = p.re.exec(text))) spans.push([m.index + m[1].length, m.index + m[0].length]);
    });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var at = 0;
    spans.forEach(function (s) {
      if (s[0] < at) return;
      el.appendChild(document.createTextNode(text.slice(at, s[0])));
      el.appendChild(h('mark', null, text.slice(s[0], s[1])));
      at = s[1];
    });
    el.appendChild(document.createTextNode(text.slice(at)));
    return el;
  }

  function buildItem(ch, r, i) {
    var m = r.m;
    var row = mark(h('div', 'dgc-msg'), 'message');
    row.setAttribute('data-id', m.id);
    if (m.avatar) { var img = h('img', 'dgc-av'); img.src = m.avatar; img.alt = ''; row.appendChild(img); }
    else row.appendChild(h('div', 'dgc-av'));
    var body = h('div', 'dgc-body');
    if (m.replyText || m.replyName) {
      var rep = h('div', 'dgc-reply');
      rep.appendChild(document.createTextNode('↪ '));
      if (m.replyName) rep.appendChild(h('b', null, '@' + m.replyName));
      rep.appendChild(document.createTextNode(' ' + m.replyText.slice(0, 140)));
      body.appendChild(rep);
    }
    var mh = h('div', 'dgc-mh');
    mh.appendChild(h('span', 'dgc-author', m.author));
    mh.appendChild(h('span', 'dgc-time', fmtWhen(m.t)));
    body.appendChild(mh);
    body.appendChild(marked(m.text, r.hits, ch));
    var foot = h('div', 'dgc-foot');
    var src = mark(h('span', 'dgc-src'), 'source');
    src.appendChild(svg(HASH, 14));
    src.appendChild(document.createTextNode(m.source));
    src.title = 'Open this message in #' + m.source;
    src.addEventListener('click', function () { viewOriginal(ch, m); });
    foot.appendChild(src);
    foot.appendChild(h('span', 'dgc-why', 'mentions ' + r.hits.slice(0, 3).join(', ')));
    var open = mark(h('button', 'dgc-open', 'View original →'), 'original');
    open.type = 'button';
    open.addEventListener('click', function () { viewOriginal(ch, m); });
    foot.appendChild(open);
    body.appendChild(foot);
    row.appendChild(body);
    if (!reduced) { row.classList.add('dgc-arrive'); row.style.animationDelay = Math.min(i * 35, 420) + 'ms'; }
    return row;
  }

  function welcome(ch, srcs) {
    var w = h('div', 'dgc-welcome');
    var badge = h('div', 'dgc-badge');
    badge.appendChild(svg(HASH, 40));
    badge.appendChild(svg([SPARK], 16, 'dgc-spark'));
    w.appendChild(badge);
    w.appendChild(h('h1', null, 'Welcome to #' + ch.label + '!'));
    var p = h('p');
    p.appendChild(document.createTextNode('A channel Modable generated locally for '));
    p.appendChild(h('b', null, ch.topic));
    p.appendChild(document.createTextNode(srcs && srcs.length
      ? ', from real messages in ' + names(srcs) + '. Nothing here was posted to the server.'
      : '. Nothing here was posted to the server.'));
    w.appendChild(p);
    var cs = h('div', 'dgc-concepts');
    cs.title = ch.understoodBy === 'model'
      ? 'What Modable’s model expects a message on this topic to mention'
      : 'Words from your request — Modable’s model was not used';
    ch.concepts.slice().sort(function (a, b) { return b.weight - a.weight; }).slice(0, 14).forEach(function (c) { cs.appendChild(h('span', 'dgc-chip', c.term)); });
    if (ch.concepts.length > 14) cs.appendChild(h('span', 'dgc-chip', '+' + (ch.concepts.length - 14)));
    w.appendChild(cs);
    return w;
  }

  function setRowsSelected() {
    section.querySelectorAll('.dgc-row').forEach(function (r) {
      r.classList.toggle('dgc-on', !!view && r.getAttribute('data-ghost') === view.ch.id);
    });
  }

  function openGhost(ch) {
    dropPill();
    if (view && view.ch === ch) return;
    if (view) closeGhost(true);
    if (!areaRect()) return;
    var el = mark(h('div', 'dgc-view dgc-root'), 'view');
    var head = h('div', 'dgc-head');
    var ic = h('span', 'dgc-icon');
    ic.appendChild(svg(HASH, 24));
    ic.appendChild(svg([SPARK], 11, 'dgc-spark'));
    head.appendChild(ic);
    head.appendChild(h('span', 'dgc-title', ch.label));
    head.appendChild(h('span', 'dgc-divider'));
    var topic = h('span', 'dgc-topic', 'Generated locally by Modable');
    head.appendChild(topic);
    function act(label, title, fn, danger, iconPaths) {
      var b = mark(h('button', 'dgc-act' + (danger ? ' dgc-danger' : '')), 'action');
      b.type = 'button'; b.title = title;
      b.appendChild(svg(iconPaths, 18));
      b.appendChild(document.createTextNode(label));
      b.addEventListener('click', fn);
      head.appendChild(b);
    }
    act('Sources', 'Choose which channels this reads', function () { toggleSources(); }, false,
      ['M4 6h16', 'M4 12h10', 'M4 18h6']);
    act('Refresh', 'Read the sources again', function () { ch.results = null; read(); }, false,
      ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7']);
    act('Remove', 'Remove this generated channel', function () { removeGhost(ch); }, true,
      ['M5 7h14', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3']);
    var scroll = h('div', 'dgc-scroll');
    el.appendChild(head);
    el.appendChild(scroll);
    view = { el: el, ch: ch, scroll: scroll, topic: topic, reading: false, token: 0 };
    document.body.appendChild(el);
    positionView();
    setRowsSelected();
    var ro = new ResizeObserver(positionView);
    var chat = chatEl();
    if (chat) ro.observe(chat);
    window.addEventListener('resize', positionView);
    view.off = function () { ro.disconnect(); window.removeEventListener('resize', positionView); };

    if (!reduced) el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });

    if (ch.results) render(); else read();
  }

  function read() {
    if (!view) return;
    var v = view;
    var token = ++v.token;
    v.reading = true;
    v.scroll.textContent = '';
    v.scroll.appendChild(welcome(v.ch, null));
    v.topic.textContent = 'Reading channels…';
    v.scroll.appendChild(h('div', 'dgc-sep', 'Reading sources'));
    var box = h('div', 'dgc-reading');
    v.scroll.appendChild(box);
    var steps = [];
    gather(v.ch, {
      cancelled: function () { return view !== v || v.token !== token; },
      plan: function (srcs) {
        srcs.forEach(function (s) {
          var st = h('div', 'dgc-step');
          st.appendChild(h('i'));
          st.appendChild(h('span', null, '#' + s.name));
          st.appendChild(h('em'));
          box.appendChild(st);
          steps.push(st);
        });
        if (!srcs.length) box.appendChild(h('div', 'dgc-step', 'No text channels found in this server.'));
      },
      step: function (i, state, n) {
        var st = steps[i];
        if (!st) return;
        st.classList.remove('dgc-active');
        st.classList.add('dgc-' + state);
        if (n != null) st.querySelector('em').textContent = n + ' messages';
      },
    }).then(function () {
      lastPath = location.pathname;
      if (view !== v || v.token !== token) return;
      v.reading = false;
      render();
    }, function (err) {
      lastPath = location.pathname;
      if (view !== v) return;
      v.reading = false;
      v.scroll.appendChild(h('div', 'dgc-empty', 'Could not read the sources: ' + ((err && err.message) || err)));
    });
  }

  function render() {
    var v = view;
    var ch = v.ch;
    var res = ch.results || [];
    var srcs = (ch.read && ch.read.channels) || [];
    v.topic.textContent = 'Generated from ' + srcs.length + (srcs.length === 1 ? ' channel' : ' channels') + ' · ' +
      res.length + (res.length === 1 ? ' relevant message' : ' relevant messages');
    v.scroll.textContent = '';
    v.scroll.appendChild(welcome(ch, srcs));
    if (!res.length) {
      v.scroll.appendChild(h('div', 'dgc-empty',
        'None of the ' + ((ch.read && ch.read.messages) || 0) + ' messages read from ' + (names(srcs) || 'the sources') +
        ' mention ' + ch.topic + '. Try adding channels under Sources.'));
      return;
    }
    v.scroll.appendChild(h('div', 'dgc-sep', 'Most relevant · ' + ((ch.read && ch.read.messages) || 0) + ' messages read'));
    res.forEach(function (r, i) { v.scroll.appendChild(buildItem(ch, r, i)); });
  }

  function closeGhost(immediate) {
    if (!view) return;
    var v = view;
    view = null;
    v.token++;
    if (v.off) v.off();
    setRowsSelected();
    if (immediate || reduced) { v.el.remove(); return; }
    v.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' }).onfinish = function () { v.el.remove(); };
  }

  function removeGhost(ch) {
    closeGhost(false);
    registry.channels = registry.channels.filter(function (c) { return c !== ch; });
    var row = section.querySelector('[data-ghost="' + ch.id + '"]');
    if (row && !reduced) {
      row.animate([{ opacity: 1, height: '32px' }, { opacity: 0, height: '0px', marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }],
        { duration: 220, easing: 'ease-in', fill: 'forwards' }).onfinish = renderSection;
    } else renderSection();
  }

  // Discord's own message route: it loads the history around the message,
  // scrolls to it and highlights it, exactly as a message link does.
  function viewOriginal(ch, m) {
    closeGhost(false);
    navigating++;
    route('/channels/' + ch.guild + '/' + m.channel + '/' + m.id).then(function () {
      navigating--;
      lastPath = location.pathname;
      showPill(ch, m.channel);
    }, function () { navigating--; });
  }

  // A way back to the Ghost Channel from the source, until the user moves on.
  function showPill(ch, channel) {
    dropPill();
    var chat = chatEl();
    if (!chat) return;
    var r = chat.getBoundingClientRect();
    var b = mark(h('button', 'dgc-pill dgc-root'), 'back');
    b.type = 'button';
    b.appendChild(document.createTextNode('←'));
    b.appendChild(svg([SPARK], 12, 'dgc-spark'));
    b.appendChild(document.createTextNode('Back to #' + ch.label));
    b.addEventListener('click', function () { openGhost(ch); });
    b.style.top = (r.top + 12) + 'px';
    document.body.appendChild(b);
    b.style.left = (r.left + r.width / 2 - b.offsetWidth / 2) + 'px';
    backPill = { el: b, channel: channel };
  }
  function dropPill() { if (backPill) { backPill.el.remove(); backPill = null; } }

  /* -------------------------------------------------------------- sources */

  function toggleSources() {
    if (!view) return;
    var open = view.el.querySelector('.dgc-pop');
    if (open) { open.remove(); return; }
    var ch = view.ch;
    var pop = mark(h('div', 'dgc-pop'), 'sources');
    pop.appendChild(h('h3', null, 'Sources'));
    pop.appendChild(h('p', null, 'Text channels in this server that #' + ch.label + ' reads.'));
    var list = h('div', 'dgc-list');
    list.appendChild(h('div', 'dgc-empty', 'Loading channels…'));
    pop.appendChild(list);
    var foot = h('div', 'dgc-popfoot');
    var cancel = h('button', 'dgc-btn dgc-quiet', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', function () { pop.remove(); });
    var apply = h('button', 'dgc-btn', 'Read these');
    apply.type = 'button';
    foot.appendChild(cancel);
    foot.appendChild(apply);
    pop.appendChild(foot);
    view.el.appendChild(pop);
    catalog().then(function (cat) {
      if (!pop.isConnected) return;
      list.textContent = '';
      var chosen = ch.sources || defaultSources(ch, cat);
      var pats = patterns(ch);
      var sorted = cat.slice().sort(function (a, b) {
        var ca = chosen.indexOf(a.id) >= 0, cb = chosen.indexOf(b.id) >= 0;
        if (ca !== cb) return ca ? -1 : 1;
        return nameMatches(b.name, pats).length - nameMatches(a.name, pats).length;
      });
      sorted.forEach(function (c) {
        var opt = h('label', 'dgc-opt');
        var box = h('input');
        box.type = 'checkbox';
        box.value = c.id;
        box.checked = chosen.indexOf(c.id) >= 0;
        opt.appendChild(box);
        opt.appendChild(h('span', null, '#' + c.name));
        if (nameMatches(c.name, pats).length) opt.appendChild(h('em', null, 'matches topic'));
        list.appendChild(opt);
      });
      apply.addEventListener('click', function () {
        var ids = [].map.call(list.querySelectorAll('input:checked'), function (x) { return x.value; });
        if (!ids.length) return;
        ch.sources = ids.slice(0, 8);
        ch.results = null;
        pop.remove();
        read();
      });
    });
  }

  /* ------------------------------------------------------------- teardown */

  hooks[KEY] = function (opts) {
    closeGhost(true);
    dropPill();
    cleanups.forEach(function (off) { try { off(); } catch (e) {} });
    cleanups = [];
    section.remove();
    style.remove();
    document.querySelectorAll('[data-modable^="discord-ghost-channel"]').forEach(function (n) { n.remove(); });
    // Modable's revert takes the channels too; a re-injection keeps them.
    if (!(opts && opts.keep)) delete window.__modableGhostChannels;
    delete hooks[KEY];
  };

  return { ok: true, placed: section.isConnected, channel: fresh.label, generated: channelsHere().length };
})(/*MODABLE_CONFIG*/null);
