/*
 * Discord Conversation Map — a Modable layer for the Discord desktop app.
 *
 * Re-reads the current text channel's rendered messages as separate
 * conversations laid out on a pannable, zoomable map, and puts the channel
 * back without touching it. The map is an overlay over the chat area; it never
 * writes to Discord's nodes, and the only native thing it changes is the chat
 * element's inline style while open, which is saved and restored verbatim.
 *
 * Anchors, all read from the live DOM (ids and aria, not hashed class names):
 *   main[aria-label$="(channel)"]               the chat area the map covers
 *   ol[data-list-id="chat-messages"]            the rendered message list
 *   li[id^="chat-messages-"]                    one message; id ends in its id
 *   #message-content-<id>                       its own text (a reply's li also
 *                                               holds the replied-to text, so
 *                                               always look the id up exactly)
 *   #message-username-<id> [data-text]          author, first of a run only
 *   #message-timestamp-<id> (time[datetime])    when
 *   #message-reply-context-<id>                 a reply; the message-content id
 *                                               inside it is the replied-to id
 *   #message-accessories-<id>                   embeds, for bot replies
 *   section[aria-label="Channel header"]        where the toggle sits, in the
 *                                               row holding "Pinned Messages"
 *
 * Grouping is local, not a model: explicit replies bind messages, a 20 minute
 * silence starts a new conversation, and a long run is split only where its
 * vocabulary changes and few replies cross. Labels are the conversation's own
 * most distinctive repeated words. The map says so in its footer.
 *
 * Only the toggle and the stylesheet are claimed marks, because they are the
 * only nodes that exist straight after injection. Everything else is tagged
 * through mark() so it is not mistaken for proof the layer took.
 */
(function () {
  var KEY = 'discord-conversation-map';
  var ATTR = 'data-modable';
  var hooks = (window.__modableTeardown = window.__modableTeardown || {});

  // Injecting twice replaces the first copy rather than stacking a second.
  if (hooks[KEY]) { try { hooks[KEY](); } catch (e) {} }
  document.querySelectorAll('[data-modable^="discord-conversation-map"]').forEach(function (n) { n.remove(); });

  function chatEl() { return document.querySelector('main[aria-label$="(channel)"]'); }
  function listEl() { return document.querySelector('ol[data-list-id="chat-messages"]'); }
  function headerEl() { return document.querySelector('section[aria-label="Channel header"]'); }
  function toolbarEl() {
    var h = headerEl();
    var pin = h && (h.querySelector('[aria-label="Pinned Messages"]') || h.querySelector('[aria-label="Threads"]'));
    return pin ? pin.parentElement : null;
  }

  if (!headerEl() || !toolbarEl()) {
    return { ok: false, reason: 'Discord channel header not found — open a text channel first' };
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cleanups = [];
  var state = null; // non-null while the map is open

  function mark(el, part) { el.setAttribute(ATTR, KEY + '-' + part); return el; }
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  var NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* ---------------------------------------------------------------- style */

  // Discord's own theme variables, with the dark theme's values as fallbacks,
  // so the map follows light, dark and custom themes.
  var style = document.createElement('style');
  style.setAttribute('data-modable', 'discord-conversation-map-style');
  style.textContent = [
    '.dcm-root{--dcm-bg:var(--background-base-lower,var(--background-primary,#1a1a1e));',
    ' --dcm-card:var(--background-base-low,var(--background-secondary,#202024));',
    ' --dcm-fg:var(--text-default,var(--text-normal,#dbdee1));--dcm-strong:var(--text-strong,var(--header-primary,#f2f3f5));',
    ' --dcm-mute:var(--text-muted,#949ba4);--dcm-accent:var(--brand-500,#5865f2);',
    ' --dcm-line:color-mix(in oklab,var(--dcm-fg) 13%,transparent);--dcm-line2:color-mix(in oklab,var(--dcm-fg) 7%,transparent);',
    ' --dcm-hover:color-mix(in oklab,var(--dcm-fg) 6%,transparent);--dcm-faint:color-mix(in oklab,var(--dcm-mute) 70%,transparent)}',

    '.dcm-toggle{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;margin:0 8px 0 0;border-radius:6px;border:0;',
    ' background:transparent;color:var(--interactive-normal,#b5bac1);font-family:inherit;font-size:14px;font-weight:500;line-height:1;',
    ' cursor:pointer;white-space:nowrap;flex:none;transition:background .12s,color .12s}',
    '.dcm-toggle:hover{color:var(--interactive-hover,#dbdee1);background:var(--background-modifier-hover,rgba(78,80,88,.3))}',
    '.dcm-toggle:focus-visible{outline:2px solid var(--focus-primary,#00b0f4);outline-offset:1px}',
    '.dcm-toggle svg{width:16px;height:16px;flex:none}',
    '.dcm-toggle.dcm-on{color:var(--interactive-active,#fff);background:var(--background-modifier-selected,rgba(78,80,88,.6))}',

    '.dcm-view{position:fixed;z-index:90;overflow:hidden;font-family:var(--font-primary,inherit);color:var(--dcm-fg);',
    ' -webkit-font-smoothing:antialiased;user-select:none}',
    '.dcm-bg{position:absolute;inset:0;background:var(--dcm-bg);',
    ' background-image:radial-gradient(color-mix(in oklab,var(--dcm-fg) 9%,transparent) 1px,transparent 1.2px);background-size:22px 22px}',
    '.dcm-port{position:absolute;inset:0;cursor:grab;outline:none;touch-action:none}',
    '.dcm-port.dcm-drag{cursor:grabbing}',
    '.dcm-canvas{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform}',
    '.dcm-canvas.dcm-glide{transition:transform .42s cubic-bezier(.2,.8,.2,1)}',
    '.dcm-wires{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}',
    '.dcm-wires path{fill:none;stroke-linecap:round}',

    '.dcm-rootnode{position:absolute;display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px 18px;border-radius:12px;',
    ' background:var(--dcm-card);box-shadow:0 0 0 1px var(--dcm-line2),0 8px 24px rgba(0,0,0,.18);white-space:nowrap}',
    '.dcm-rootname{font-size:16px;font-weight:600;color:var(--dcm-strong);display:flex;align-items:center;gap:6px}',
    '.dcm-rootname b{font-weight:400;color:var(--dcm-mute);font-size:20px;line-height:1}',
    '.dcm-rootsub{font-size:12px;color:var(--dcm-mute)}',

    '.dcm-card{position:absolute;width:312px;border-radius:10px;background:var(--dcm-card);',
    ' box-shadow:0 0 0 1px var(--dcm-line2),0 6px 20px rgba(0,0,0,.14);transition:opacity .25s ease,box-shadow .2s ease,left .35s cubic-bezier(.2,.8,.2,1),top .35s cubic-bezier(.2,.8,.2,1)}',
    '.dcm-card:hover{box-shadow:0 0 0 1px var(--dcm-line),0 8px 24px rgba(0,0,0,.18)}',
    '.dcm-card.dcm-focus{box-shadow:0 0 0 1px color-mix(in oklab,var(--dcm-tint) 55%,transparent),0 12px 32px rgba(0,0,0,.24)}',
    '.dcm-dim .dcm-card:not(.dcm-focus){opacity:.32}',
    '.dcm-ch{display:flex;align-items:center;gap:8px;padding:12px 14px 2px;cursor:pointer}',
    '.dcm-dot{width:8px;height:8px;border-radius:3px;flex:none;background:var(--dcm-tint)}',
    '.dcm-title{margin:0;flex:1;min-width:0;font-size:15px;font-weight:600;color:var(--dcm-strong);',
    ' overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.005em}',
    '.dcm-count{font-size:12px;color:var(--dcm-mute);font-variant-numeric:tabular-nums}',
    '.dcm-cmeta{display:flex;align-items:center;gap:8px;padding:4px 14px 10px 30px;font-size:12px;color:var(--dcm-mute);cursor:pointer}',
    '.dcm-stack{display:flex;flex:none}',
    '.dcm-stack img,.dcm-stack span{width:16px;height:16px;border-radius:50%;margin-left:-4px;box-shadow:0 0 0 2px var(--dcm-card);',
    ' background:var(--dcm-line);object-fit:cover}',
    '.dcm-stack :first-child{margin-left:0}',
    '.dcm-who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dcm-cbody{position:relative;padding:2px 6px 8px;border-top:1px solid var(--dcm-line2)}',
    '.dcm-cbody svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}',
    '.dcm-cbody svg path{fill:none;stroke:color-mix(in oklab,var(--dcm-tint) 45%,var(--dcm-mute));stroke-width:1.5;opacity:.55}',

    '.dcm-row{position:relative;display:flex;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer}',
    '.dcm-row:hover{background:var(--dcm-hover)}',
    '.dcm-row:focus-visible{outline:2px solid var(--focus-primary,#00b0f4);outline-offset:-2px}',
    '.dcm-av{width:20px;height:20px;border-radius:50%;flex:none;margin-top:1px;object-fit:cover;background:var(--dcm-line)}',
    '.dcm-rb{min-width:0;flex:1}',
    '.dcm-rh{display:flex;align-items:baseline;gap:6px;font-size:12.5px;line-height:16px}',
    '.dcm-ra{font-weight:600;color:var(--dcm-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dcm-rt{color:var(--dcm-faint);font-size:11px;flex:none}',
    '.dcm-jump{margin-left:auto;color:var(--dcm-faint);font-size:11px;opacity:0;flex:none;transition:opacity .12s}',
    '.dcm-row:hover .dcm-jump{opacity:1}',
    '.dcm-rx{font-size:13.5px;line-height:18px;color:var(--dcm-fg);overflow-wrap:anywhere;',
    ' display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.dcm-key .dcm-rx{-webkit-line-clamp:3}',
    '.dcm-open .dcm-rx{-webkit-line-clamp:4}',
    '.dcm-quiet .dcm-rx{color:var(--dcm-mute)}',
    '.dcm-ref{font-size:11.5px;line-height:15px;color:var(--dcm-mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:1px}',
    '.dcm-tag{display:inline-block;padding:0 4px;border-radius:3px;background:var(--dcm-line2);font-size:10.5px;color:var(--dcm-mute);margin-left:4px}',
    '.dcm-more{display:block;width:calc(100% - 16px);margin:2px 8px 10px;padding:6px 0;border:0;border-radius:6px;background:var(--dcm-line2);',
    ' color:var(--dcm-mute);font:inherit;font-size:12px;cursor:pointer}',
    '.dcm-more:hover{background:var(--dcm-line);color:var(--dcm-fg)}',

    '.dcm-scrim{position:absolute;left:0;right:0;pointer-events:none;transition:opacity .25s ease}',
    '.dcm-scrim-top{top:0;height:84px;background:linear-gradient(var(--dcm-bg) 45%,transparent)}',
    '.dcm-scrim-bot{bottom:0;height:64px;background:linear-gradient(transparent,var(--dcm-bg) 70%)}',
    '.dcm-view:not(.dcm-ready) .dcm-scrim{opacity:0}',
    '.dcm-hud{position:absolute;display:flex;align-items:center;gap:6px;transition:opacity .25s ease,transform .25s ease}',
    '.dcm-view:not(.dcm-ready) .dcm-hud{opacity:0;transform:translateY(-4px)}',
    '.dcm-top{left:16px;top:14px;right:16px;justify-content:space-between;pointer-events:none}',
    '.dcm-top>*{pointer-events:auto}',
    '.dcm-heading{display:flex;flex-direction:column;gap:2px}',
    '.dcm-heading h2{margin:0;font-size:14px;font-weight:600;color:var(--dcm-strong);display:flex;align-items:center;gap:7px}',
    '.dcm-heading h2 i{width:7px;height:7px;border-radius:2px;background:var(--dcm-accent)}',
    '.dcm-heading p{margin:0 0 0 14px;font-size:12px;color:var(--dcm-mute)}',
    '.dcm-btn{height:28px;padding:0 10px;border-radius:6px;border:0;background:var(--dcm-card);color:var(--dcm-fg);font:inherit;font-size:13px;',
    ' font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;box-shadow:0 0 0 1px var(--dcm-line2)}',
    '.dcm-btn:hover{background:color-mix(in oklab,var(--dcm-card),var(--dcm-fg) 7%);color:var(--dcm-strong)}',
    '.dcm-btn:focus-visible{outline:2px solid var(--focus-primary,#00b0f4);outline-offset:1px}',
    '.dcm-btn kbd{font:inherit;font-size:11px;color:var(--dcm-faint)}',
    '.dcm-zoom{right:16px;bottom:14px;padding:3px;border-radius:8px;background:var(--dcm-card);box-shadow:0 0 0 1px var(--dcm-line2),0 4px 14px rgba(0,0,0,.16)}',
    '.dcm-zoom .dcm-btn{box-shadow:none;background:transparent;height:26px;padding:0 8px}',
    '.dcm-zoom .dcm-btn:hover{background:var(--dcm-hover)}',
    '.dcm-pct{min-width:42px;text-align:center;font-size:12px;color:var(--dcm-mute);font-variant-numeric:tabular-nums}',
    '.dcm-sep{width:1px;height:16px;background:var(--dcm-line2)}',
    '.dcm-foot{left:16px;bottom:16px;max-width:52%;font-size:11.5px;line-height:15px;color:var(--dcm-faint)}',
    '.dcm-toast{position:absolute;left:50%;bottom:58px;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:var(--dcm-card);',
    ' box-shadow:0 0 0 1px var(--dcm-line),0 6px 18px rgba(0,0,0,.25);font-size:13px;color:var(--dcm-fg);transition:opacity .3s}',
    '.dcm-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--dcm-mute)}',

    '.dcm-flash{position:fixed;z-index:89;pointer-events:none;border-radius:4px;',
    ' background:color-mix(in oklab,var(--brand-500,#5865f2) 16%,transparent);box-shadow:inset 2px 0 0 var(--brand-500,#5865f2);transition:opacity .9s ease}',
  ].join('\n');
  document.head.appendChild(style);

  // Restrained accents, one per conversation, drawn from Discord's palette.
  var TINTS = ['#5865f2', '#23a55a', '#f0b232', '#eb459f', '#00a8fc', '#a371f7', '#e67e22', '#1abc9c'];

  /* --------------------------------------------------------------- toggle */

  function icon() {
    var svg = s('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round' });
    svg.appendChild(s('circle', { cx: '8', cy: '3', r: '1.7' }));
    svg.appendChild(s('circle', { cx: '3.2', cy: '12.6', r: '1.7' }));
    svg.appendChild(s('circle', { cx: '12.8', cy: '12.6', r: '1.7' }));
    svg.appendChild(s('path', { d: 'M8 4.8v2.6M8 7.4c-2.6 0-4.8 1-4.8 3.4M8 7.4c2.6 0 4.8 1 4.8 3.4' }));
    return svg;
  }

  var toggle = document.createElement('button');
  toggle.setAttribute('data-modable', 'discord-conversation-map-toggle');
  toggle.type = 'button';
  toggle.className = 'dcm-toggle';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('aria-label', 'Conversation Map');
  toggle.setAttribute('title', 'Conversation Map — see the separate conversations in this channel');
  toggle.appendChild(icon());
  toggle.appendChild(h('span', null, 'Conversation Map'));
  toggle.addEventListener('click', function () { state ? exit() : enter(); });

  // First in the header's icon row, before Threads and Pinned Messages.
  function placeToggle() {
    var row = toolbarEl();
    if (!row) return false;
    if (toggle.parentElement !== row) row.insertBefore(toggle, row.firstChild);
    return true;
  }
  if (!placeToggle()) { style.remove(); return { ok: false, reason: 'no place for the Conversation Map control' }; }

  // Discord re-renders the header when the channel changes. Put the control
  // back, and leave the map if the channel under it changed. Watches only the
  // app layer holding the header, and does the work at most once a frame.
  var path = location.pathname;
  var scope = (function () {
    var n = headerEl();
    for (var i = 0; i < 4 && n && n.parentElement && n.parentElement !== document.body; i++) n = n.parentElement;
    return n || document.body;
  })();
  var queued = false;
  var mo = new MutationObserver(function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      if (location.pathname !== path) {
        path = location.pathname;
        if (state) exit(true);
      }
      if (!toggle.isConnected || toggle.parentElement !== toolbarEl()) placeToggle();
    });
  });
  mo.observe(scope, { childList: true, subtree: true });
  cleanups.push(function () { mo.disconnect(); });

  /* -------------------------------------------------------- read channel */

  function channelName() {
    var m = chatEl();
    var a = m ? (m.getAttribute('aria-label') || '').replace(/\s*\(channel\)\s*$/, '') : '';
    return a || document.title.split(' | ')[0].replace(/^#/, '');
  }

  function cleanText(node, dropCode) {
    if (!node) return '';
    var c = node.cloneNode(true);
    // The "(edited)" marker carries its date as visually hidden text beside it.
    c.querySelectorAll('time').forEach(function (x) { (x.closest('[class^="timestamp"]') || x).remove(); });
    c.querySelectorAll(dropCode ? '[aria-hidden="true"], code, pre' : '[aria-hidden="true"]').forEach(function (x) { x.remove(); });
    return (c.innerText || c.textContent || '')
      .replace(/\u00a0/g, ' ').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s*\(edited\)\s*$/, '').replace(/\s+/g, ' ').trim();
  }

  // What the rendered list actually holds, in order. Discord prints a name and
  // avatar only on the first message of a run from one author; a message
  // without one belongs to the run above it.
  function readMessages() {
    var out = [];
    var prev = null;
    var avatars = {};
    document.querySelectorAll('ol[data-list-id="chat-messages"] > li[id^="chat-messages-"]').forEach(function (li) {
      var id = li.id.split('-').pop();
      if (!/^\d+$/.test(id)) return;
      var content = document.getElementById('message-content-' + id);
      var stampEl = document.getElementById('message-timestamp-' + id);
      var userEl = document.getElementById('message-username-' + id);
      var named = userEl && userEl.querySelector('[data-text]');
      var author = named ? named.getAttribute('data-text') : (userEl ? cleanText(userEl) : '');
      var bot = !!(userEl && userEl.parentElement && /\bAPP\b/.test(userEl.parentElement.innerText));
      var av = li.querySelector('img[class^="avatar"]');
      if (!author && prev) { author = prev.author; bot = prev.bot; }
      if (author && av && !avatars[author]) avatars[author] = av.getAttribute('src');

      var text = cleanText(content);
      var prose = cleanText(content, true);
      var code = '';
      if (content) content.querySelectorAll('code').forEach(function (c) { code += '\n' + c.textContent; });
      var embed = false;
      if (!text) {
        var acc = document.getElementById('message-accessories-' + id);
        text = acc ? cleanText(acc).slice(0, 220) : '';
        embed = !!text;
      }
      var rc = document.getElementById('message-reply-context-' + id);
      var ref = rc && rc.querySelector('[id^="message-content-"]');
      var refName = rc && rc.querySelector('[data-text]');
      var t = stampEl ? Date.parse(stampEl.getAttribute('datetime')) : NaN;

      var msg = {
        id: id, li: li, author: author || 'Unknown', bot: bot, text: text, prose: prose, code: code, embed: embed,
        t: isNaN(t) ? (prev ? prev.t : 0) : t,
        replyTo: ref ? ref.id.replace('message-content-', '') : '',
        replyName: refName ? refName.getAttribute('data-text').replace(/^@/, '') : '',
        replyText: ref ? cleanText(ref) : '',
        children: [],
      };
      out.push(msg);
      prev = msg;
    });
    out.forEach(function (m) { m.avatar = avatars[m.author] || ''; });
    return out;
  }

  /* ------------------------------------------------------------ grouping */

  var STOP = ('a an the and or but if then else so to of in on at by for with from as is are was were be been being it its this that these those ' +
    'i im me my we our you your he she they them their his her what which who whom how why when where there here not no yes yep yea yeah ' +
    'do does did done doing have has had having can could would should will just also too very really more most much many some any all ' +
    'one two get got make made like know think see look want need use used using thing things way well ok okay oh ohh lol hmm maybe ' +
    'about into than only even still again now out up down over same other another each every something nothing anything someone ' +
    'print import def return none true false self elif while range len str int list dict set tuple class pass break ' +
    'https http www com dont didnt isnt thats whats cant wont ive youre theyre ' +
    'sure right good better nice thanks thank please sorry hey hi hello mean going work works code output edited job ' +
    'completed eval value values example first time point different problem instead approach result results').split(/\s+/);
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = 1; });

  // Prose words, plus from code only what is called or reached by name
  // (groupby(, itertools.groupby) — a code block's local variables are not
  // what a conversation is about.
  function terms(msg, names) {
    var text = (msg.prose || '').replace(/^![a-z]+\s+/i, ' ').replace(/['’]/g, ''); // a bot command's verb is not its subject
    var words = text.toLowerCase().match(/[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*/g) || [];
    var code = (msg.code || '').toLowerCase();
    var re = /([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)+|[a-z_][a-z0-9_]*(?=\s*\())/g, m;
    while ((m = re.exec(code))) words.push(m[1]);
    var seen = {};
    words.forEach(function (w) {
      if (w.length < 3 || STOPSET[w] || names[w]) return;
      seen[w] = 1;
      // itertools.groupby also counts as groupby
      if (w.indexOf('.') > 0) w.split('.').forEach(function (p) { if (p.length >= 3 && !STOPSET[p]) seen[p] = 1; });
    });
    return seen;
  }

  function jaccard(a, b) {
    var inter = 0, uni = 0, k;
    for (k in a) { uni++; if (b[k]) inter++; }
    for (k in b) if (!a[k]) uni++;
    return uni ? inter / uni : 0;
  }
  function bag(msgs) {
    var out = {};
    msgs.forEach(function (m) { for (var k in m.terms) out[k] = 1; });
    return out;
  }

  var GAP = 20 * 60 * 1000;

  function group(messages) {
    var byId = {};
    var names = {};
    messages.forEach(function (m, i) {
      byId[m.id] = m; m.index = i;
      m.author.toLowerCase().split(/\W+/).forEach(function (w) { if (w) names[w] = 1; });
      if (m.replyName) names[m.replyName.toLowerCase()] = 1;
    });
    messages.forEach(function (m) {
      m.terms = m.bot ? {} : terms(m, names);
      m.parent = m.replyTo && byId[m.replyTo] ? byId[m.replyTo] : null;
      if (m.parent) m.parent.children.push(m);
    });

    // 1. A long silence starts a new conversation, unless the message after it
    //    is a reply into the one before.
    var runs = [];
    var cur = [];
    messages.forEach(function (m, i) {
      var prev = messages[i - 1];
      if (prev && m.t - prev.t > GAP && !(m.parent && m.parent.run === runs.length)) {
        runs.push(cur); cur = [];
      }
      m.run = runs.length;
      cur.push(m);
    });
    if (cur.length) runs.push(cur);

    // 2. A long run is split where what is being talked about changes: little
    //    shared vocabulary either side, and few replies reaching across.
    var parts = [];
    function split(run) {
      if (run.length < 16) { parts.push(run); return; }
      var best = null;
      for (var i = 6; i <= run.length - 6; i++) {
        var left = bag(run.slice(Math.max(0, i - 10), i));
        var right = bag(run.slice(i, i + 10));
        var crossing = 0;
        for (var j = i; j < run.length; j++) {
          var p = run[j].parent;
          if (p && p.index < run[i].index && p.index >= run[0].index) crossing++;
        }
        var pause = run[i].t - run[i - 1].t;
        var score = jaccard(left, right) + crossing * 0.09 - (pause > 150000 ? 0.04 : 0);
        if (!best || score < best.score) best = { i: i, score: score };
      }
      if (best && best.score < 0.1) {
        split(run.slice(0, best.i));
        split(run.slice(best.i));
      } else {
        parts.push(run);
      }
    }
    runs.forEach(split);

    // Document frequency across everything loaded, for labels.
    var df = {};
    messages.forEach(function (m) { for (var k in m.terms) df[k] = (df[k] || 0) + 1; });
    var N = messages.length;

    return parts.map(function (msgs, ci) {
      var cluster = { id: 'c' + ci, msgs: msgs, tint: TINTS[ci % TINTS.length] };
      msgs.forEach(function (m) { m.cluster = cluster; });
      cluster.label = labelFor(msgs, df, N);
      cluster.authors = [];
      msgs.forEach(function (m) {
        if (cluster.authors.indexOf(m.author) < 0 && !m.bot) cluster.authors.push(m.author);
      });
      if (!cluster.authors.length) cluster.authors.push(msgs[0].author);
      return cluster;
    });
  }

  // The conversation's own words: terms repeated across at least two of its
  // messages, weighted by how particular they are to it. Without any, the
  // opening message stands as the label, quoted, rather than a guessed topic.
  function labelFor(msgs, df, N) {
    var local = {};
    msgs.forEach(function (m) { for (var k in m.terms) local[k] = (local[k] || 0) + 1; });
    var ranked = Object.keys(local)
      .filter(function (k) { return local[k] >= 2; })
      .map(function (k) { return { k: k, w: local[k] * Math.log(1 + N / df[k]) + (k.indexOf('.') > 0 ? 0.5 : 0) }; })
      .sort(function (a, b) { return b.w - a.w; });
    var picked = [];
    ranked.forEach(function (r) {
      if (picked.length >= 2) return;
      // itertools.groupby already says groupby
      if (picked.some(function (p) { return p.indexOf(r.k) >= 0 || r.k.indexOf(p) >= 0; })) return;
      picked.push(r.k);
    });
    if (picked.length) {
      var label = picked.join(' · ');
      return { text: label.charAt(0).toUpperCase() + label.slice(1), quoted: false };
    }
    var opener = msgs.filter(function (m) { return !m.bot && m.text; })[0] || msgs[0];
    var words = (opener.text || '').split(' ');
    var t = words.slice(0, 7).join(' ');
    if (words.length > 7 || t.length > 40) t = t.slice(0, 40).replace(/\s+\S*$/, '') + '…';
    return { text: '“' + (t || 'Untitled') + '”', quoted: true };
  }

  /* --------------------------------------------------------- tree / rows */

  // Which messages a collapsed card shows: the opener, messages that drew
  // replies, the replies themselves, the longest human posts — at most three,
  // plus anything needed to keep a shown reply attached to what it answers.
  var KEEP = 3;
  function keyMessages(cluster) {
    var msgs = cluster.msgs;
    if (msgs.length <= KEEP + 1) return msgs.slice();
    var scored = msgs.map(function (m, i) {
      var sc = 0;
      if (i === 0) sc += 10;
      sc += m.children.length * 3;
      if (m.parent && m.parent.cluster === cluster) sc += 2;
      if (!m.bot) sc += Math.min(m.text.length, 160) / 80;
      if (m.bot || m.text.length < 4) sc -= 3;
      return { m: m, sc: sc };
    }).sort(function (a, b) { return b.sc - a.sc; });
    var keep = {};
    scored.slice(0, KEEP).forEach(function (x) { keep[x.m.id] = 1; });
    msgs.forEach(function (m) {
      if (!keep[m.id]) return;
      for (var p = m.parent; p && p.cluster === cluster; p = p.parent) keep[p.id] = 1;
    });
    return msgs.filter(function (m) { return keep[m.id]; });
  }

  // Replies sit under what they answer; everything else keeps channel order.
  function treeOrder(shown, cluster) {
    var set = {};
    shown.forEach(function (m) { set[m.id] = 1; });
    function visParent(m) {
      for (var p = m.parent; p; p = p.parent) {
        if (p.cluster !== cluster) return null;
        if (set[p.id]) return p;
      }
      return null;
    }
    var kids = {};
    var roots = [];
    shown.forEach(function (m) {
      var p = visParent(m);
      m.vis = p;
      if (p) (kids[p.id] = kids[p.id] || []).push(m); else roots.push(m);
    });
    var out = [];
    function walk(m, depth) {
      m.depth = depth;
      out.push(m);
      (kids[m.id] || []).forEach(function (c) { walk(c, Math.min(depth + 1, 3)); });
    }
    roots.forEach(function (m) { walk(m, 0); });
    return out;
  }

  function fmtTime(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fmtDay(t) {
    var d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Today';
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function span(msgs) {
    var a = msgs[0].t, b = msgs[msgs.length - 1].t;
    var day = fmtDay(a);
    if (fmtDay(b) !== day) return day + ' – ' + fmtDay(b);
    return day + ', ' + fmtTime(a) + (b - a > 60000 ? '–' + fmtTime(b) : '');
  }

  function avatarEl(src, cls) {
    if (src) {
      var img = h('img', cls);
      img.src = src; img.alt = ''; img.draggable = false;
      return img;
    }
    return h('span', cls);
  }

  function buildRow(m, isKey) {
    var row = mark(h('div', 'dcm-row'), 'message');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('data-id', m.id);
    row.style.marginLeft = (m.depth * 18) + 'px';
    if (isKey) row.classList.add('dcm-key');
    if (m.bot || m.embed) row.classList.add('dcm-quiet');
    row.appendChild(avatarEl(m.avatar, 'dcm-av'));
    var body = h('div', 'dcm-rb');
    var head = h('div', 'dcm-rh');
    head.appendChild(h('span', 'dcm-ra', m.author));
    head.appendChild(h('span', 'dcm-rt', fmtTime(m.t)));
    head.appendChild(h('span', 'dcm-jump', 'Jump ↗'));
    body.appendChild(head);
    // A reply whose original is not drawn above it says what it answers.
    if (m.replyTo && !m.vis) {
      var r = h('div', 'dcm-ref', '↩ ' + (m.replyName ? '@' + m.replyName + ': ' : '') + (m.replyText || 'original message'));
      if (m.parent && m.parent.cluster !== m.cluster) r.title = 'Replying to a message in ' + m.parent.cluster.label.text;
      body.appendChild(r);
    }
    var x = h('div', 'dcm-rx', m.text || '(attachment)');
    if (m.embed) x.appendChild(h('span', 'dcm-tag', 'embed'));
    body.appendChild(x);
    row.appendChild(body);
    if (m.text.length > 120) row.title = m.text.slice(0, 400);
    m.row = row;
    return row;
  }

  function buildCard(st, c) {
    var expanded = !!st.expanded[c.id];
    var shown = expanded ? c.msgs.slice() : keyMessages(c);
    var ordered = treeOrder(shown, c);
    c.msgs.forEach(function (m) { m.row = null; });

    var card = c.el || mark(h('div', 'dcm-card'), 'cluster');
    card.textContent = '';
    card.style.setProperty('--dcm-tint', c.tint);
    card.setAttribute('data-cluster', c.id);
    card.classList.toggle('dcm-open', expanded);

    var head = h('div', 'dcm-ch');
    head.appendChild(h('i', 'dcm-dot'));
    var title = h('h3', 'dcm-title', c.label.text);
    title.title = c.label.quoted ? 'No repeated terms — labelled by its opening message' : 'Most distinctive repeated terms in this conversation';
    head.appendChild(title);
    head.appendChild(h('span', 'dcm-count', c.msgs.length + (c.msgs.length === 1 ? ' message' : ' messages')));
    card.appendChild(head);

    var meta = h('div', 'dcm-cmeta');
    var stack = h('div', 'dcm-stack');
    c.authors.slice(0, 4).forEach(function (a) {
      var m = c.msgs.filter(function (x) { return x.author === a; })[0];
      var av = avatarEl(m && m.avatar, '');
      av.title = a;
      stack.appendChild(av);
    });
    meta.appendChild(stack);
    var who = c.authors.slice(0, 2).join(', ') + (c.authors.length > 2 ? ' +' + (c.authors.length - 2) : '');
    meta.appendChild(h('span', 'dcm-who', who + ' · ' + span(c.msgs)));
    card.appendChild(meta);

    var body = h('div', 'dcm-cbody');
    var svg = s('svg', { width: '1', height: '1' });
    body.appendChild(svg);
    ordered.forEach(function (m) {
      body.appendChild(buildRow(m, !expanded && (m.children.length > 0 || m === c.msgs[0])));
    });
    card.appendChild(body);

    var hidden = c.msgs.length - shown.length;
    if (hidden > 0) {
      var more = mark(h('button', 'dcm-more', 'Show ' + hidden + ' more message' + (hidden === 1 ? '' : 's')), 'more');
      more.type = 'button';
      more.addEventListener('click', function (e) { e.stopPropagation(); focus(c); });
      card.appendChild(more);
    } else if (expanded && c.msgs.length > KEEP + 1) {
      var less = mark(h('button', 'dcm-more', 'Show key messages only'), 'more');
      less.type = 'button';
      less.addEventListener('click', function (e) { e.stopPropagation(); unfocus(); st.expanded[c.id] = false; rebuild(c); });
      card.appendChild(less);
    }

    function onHead() { st.focus === c ? unfocus() : focus(c); }
    head.addEventListener('click', onHead);
    meta.addEventListener('click', onHead);
    c.el = card;
    c.svg = svg;
    c.ordered = ordered;
    return card;
  }

  // Discord's own reply shape: an elbow from the answered message's avatar
  // into the reply's.
  function drawReplies(c) {
    var svg = c.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    c.ordered.forEach(function (m) {
      if (!m.vis || !m.vis.row || !m.row) return;
      var a = m.vis.row, b = m.row;
      var ax = a.offsetLeft + 8 + 10, ay = a.offsetTop + 6 + 21 + 2;
      var bx = b.offsetLeft + 8, by = b.offsetTop + 6 + 11;
      var r = Math.min(6, Math.max(0, by - ay));
      svg.appendChild(s('path', { d: 'M' + ax + ' ' + ay + ' V' + (by - r) + ' Q' + ax + ' ' + by + ' ' + (ax + r) + ' ' + by + ' H' + (bx - 2) }));
    });
  }

  /* -------------------------------------------------------------- layout */

  var CARD_W = 312, GAP_X = 48, GAP_Y = 36, TOP = 128;

  // As many columns as make the whole map largest in this chat area — wide
  // windows get a wide map. Chosen once per opening so expanding a card does
  // not reshuffle the others.
  function chooseCols(st) {
    var p = portSize(st);
    var k = st.clusters.length;
    var best = { n: 1, sc: 0 };
    for (var n = 1; n <= k; n++) {
      var hs = [];
      for (var i = 0; i < n; i++) hs.push(TOP);
      st.clusters.forEach(function (c, i) { hs[i % n] += c.el.offsetHeight + GAP_Y; });
      var w = n * CARD_W + n * GAP_X;
      var sc = Math.min((p.w - 64) / w, (p.h - 120) / (Math.max.apply(null, hs) - GAP_Y));
      if (sc > best.sc + 0.01) best = { n: n, sc: sc };
    }
    return best.n;
  }

  function layout(st) {
    var cols = st.cols || (st.cols = chooseCols(st));
    var heights = [];
    for (var i = 0; i < cols; i++) heights.push(TOP);
    st.clusters.forEach(function (c, i) {
      var col = i % cols;
      c.x = col * (CARD_W + GAP_X);
      c.y = heights[col];
      c.col = col;
      c.h = c.el.offsetHeight;
      heights[col] += c.h + GAP_Y;
      c.el.style.left = c.x + 'px';
      c.el.style.top = c.y + 'px';
    });
    st.width = cols * CARD_W + (cols - 1) * GAP_X;
    st.height = Math.max.apply(null, heights) - GAP_Y;
    st.rootEl.style.left = (st.width / 2 - st.rootEl.offsetWidth / 2) + 'px';
    st.rootEl.style.top = '0px';
    st.clusters.forEach(drawReplies);
    drawWires(st);
  }

  // Root to conversations as a quiet tree: a trunk down from the channel, a
  // bus along the top, a rail down each gutter, and a short elbow into each
  // card's header — routed between cards, never through them.
  function drawWires(st) {
    var svg = st.wires;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var line = 'color-mix(in oklab,var(--dcm-fg) 22%,transparent)';
    var rootBottom = st.rootEl.offsetTop + st.rootEl.offsetHeight;
    var busY = TOP - 34;
    var railX = function (col) { return col * (CARD_W + GAP_X) - GAP_X / 2; };
    var used = Math.min(st.cols, st.clusters.length);
    var x0 = railX(0), x1 = railX(used - 1);
    var d = 'M' + (st.width / 2) + ' ' + rootBottom + ' V' + busY;
    d += ' M' + x0 + ' ' + (busY + 8) + ' Q' + x0 + ' ' + busY + ' ' + (x0 + 8) + ' ' + busY + ' H' + (used > 1 ? x1 : st.width / 2);
    var lows = {};
    st.clusters.forEach(function (c) { lows[c.col] = Math.max(lows[c.col] || 0, c.y + 22); });
    Object.keys(lows).forEach(function (col) {
      var x = railX(+col);
      d += ' M' + x + ' ' + (+col === 0 ? busY + 8 : busY) + ' V' + (lows[col] - 8);
    });
    svg.appendChild(s('path', { d: d, stroke: line, 'stroke-width': '1.5' }));
    st.clusters.forEach(function (c) {
      var x = railX(c.col), y = c.y + 22;
      svg.appendChild(s('path', {
        d: 'M' + x + ' ' + (y - 8) + ' Q' + x + ' ' + y + ' ' + (x + 8) + ' ' + y + ' H' + (c.x - 1),
        stroke: line, 'stroke-width': '1.5',
      }));
    });
    // Replies that reach into another conversation: thin and dashed, card to card.
    st.messages.forEach(function (m) {
      if (!m.parent || m.parent.cluster === m.cluster || !m.row) return;
      var ca = m.parent.cluster, cb = m.cluster;
      var a = m.parent.row;
      var ay = ca.y + (a ? a.offsetTop + a.parentElement.offsetTop + 14 : 22);
      var by = cb.y + m.row.offsetTop + m.row.parentElement.offsetTop + 14;
      var ax, bx, c1, c2;
      if (cb.x === ca.x) { ax = bx = ca.x + CARD_W; c1 = ax + 40; c2 = bx + 40; }
      else if (cb.x > ca.x) { ax = ca.x + CARD_W; bx = cb.x; c1 = ax + (bx - ax) / 2; c2 = c1; }
      else { ax = ca.x; bx = cb.x + CARD_W; c1 = ax - (ax - bx) / 2; c2 = c1; }
      svg.appendChild(s('path', {
        d: 'M' + ax + ' ' + ay + ' C' + c1 + ' ' + ay + ' ' + c2 + ' ' + by + ' ' + bx + ' ' + by,
        stroke: 'color-mix(in oklab,' + cb.tint + ' 50%,var(--dcm-mute))', 'stroke-width': '1.25',
        'stroke-dasharray': '3 4', opacity: '.6',
      }));
    });
  }

  /* ------------------------------------------------------------ pan/zoom */

  var MIN = 0.2, MAX = 2;

  function apply(st, glide) {
    st.canvas.classList.toggle('dcm-glide', !!glide);
    st.canvas.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')';
    st.pct.textContent = Math.round(st.s * 100) + '%';
  }
  function zoomAt(st, factor, px, py, glide) {
    var ns = Math.min(MAX, Math.max(MIN, st.s * factor));
    st.x = px - (px - st.x) * (ns / st.s);
    st.y = py - (py - st.y) * (ns / st.s);
    st.s = ns;
    apply(st, glide);
  }
  function portSize(st) { return { w: st.port.clientWidth, h: st.port.clientHeight }; }
  function fitBox(st, box, pad, cap, glide) {
    var p = portSize(st);
    var top = 64, bottom = 56;
    var sc = Math.max(MIN, Math.min(cap, (p.w - pad * 2) / box.w, (p.h - top - bottom) / box.h));
    st.s = sc;
    st.x = (p.w - box.w * sc) / 2 - box.x * sc;
    st.y = top + Math.max(0, (p.h - top - bottom - box.h * sc) / 2) - box.y * sc;
    apply(st, glide);
  }
  function fit(st, glide) {
    fitBox(st, { x: -GAP_X / 2, y: 0, w: st.width + GAP_X, h: st.height }, 32, 1, glide);
  }
  // Reading size, the channel at the top.
  function reset(st, glide) {
    var p = portSize(st);
    st.s = 1;
    st.x = Math.min(32 + GAP_X / 2, (p.w - st.width) / 2);
    st.y = 64;
    apply(st, glide);
  }

  /* --------------------------------------------------------------- focus */

  // Clicking a conversation opens it out in full and frames it.
  function focus(c) {
    var st = state;
    if (!st) return;
    if (st.focus && st.focus !== c) st.focus.el.classList.remove('dcm-focus');
    st.focus = c;
    if (!st.expanded[c.id] && c.msgs.length > KEEP + 1) { st.expanded[c.id] = true; rebuild(c); }
    c.el.classList.add('dcm-focus');
    st.canvas.classList.add('dcm-dim');
    var p = portSize(st);
    var hgt = Math.min(c.h, (p.h - 120) / 0.85);
    fitBox(st, { x: c.x - 24, y: c.y - 16, w: CARD_W + 48, h: hgt + 32 }, 24, 1.15, true);
  }
  function unfocus() {
    var st = state;
    if (!st || !st.focus) return;
    st.focus.el.classList.remove('dcm-focus');
    st.focus = null;
    st.canvas.classList.remove('dcm-dim');
  }
  function rebuild(c) {
    buildCard(state, c);
    layout(state);
  }

  /* -------------------------------------------------------- enter / exit */

  function areaRect() {
    var m = chatEl();
    if (!m) return null;
    var r = m.getBoundingClientRect();
    var hdr = headerEl();
    var right = hdr ? Math.max(r.right, hdr.getBoundingClientRect().right) : r.right;
    return { left: r.left, top: r.top, width: right - r.left, height: r.height };
  }
  function positionView() {
    if (!state) return;
    var r = areaRect();
    if (!r) { exit(true); return; }
    var v = state.view.style;
    v.left = r.left + 'px'; v.top = r.top + 'px'; v.width = r.width + 'px'; v.height = r.height + 'px';
  }

  function visibleRect(el, clip) {
    if (!el || !el.isConnected) return null;
    var r = el.getBoundingClientRect();
    if (!r.height || r.bottom < clip.top || r.top > clip.bottom) return null;
    return r;
  }

  function enter() {
    if (state) return;
    var chat = chatEl();
    if (!chat || !listEl()) return;
    var messages = readMessages();

    var view = mark(h('div', 'dcm-view dcm-root'), 'view');
    var bg = mark(h('div', 'dcm-bg'), 'bg');
    var port = mark(h('div', 'dcm-port'), 'port');
    port.tabIndex = -1;
    var canvas = mark(h('div', 'dcm-canvas'), 'canvas');
    var wires = s('svg', { class: 'dcm-wires', width: '1', height: '1' });
    canvas.appendChild(wires);
    port.appendChild(canvas);
    view.appendChild(bg);
    view.appendChild(port);

    view.appendChild(h('div', 'dcm-scrim dcm-scrim-top'));
    view.appendChild(h('div', 'dcm-scrim dcm-scrim-bot'));

    // Header: what this is, what it covers, the way back.
    var top = h('div', 'dcm-hud dcm-top');
    var heading = h('div', 'dcm-heading');
    var h2 = h('h2');
    h2.appendChild(h('i'));
    h2.appendChild(document.createTextNode('Conversation Map'));
    heading.appendChild(h2);
    var sub = h('p');
    heading.appendChild(sub);
    var back = mark(h('button', 'dcm-btn'), 'back');
    back.type = 'button';
    back.appendChild(document.createTextNode('Back to Chat'));
    back.appendChild(h('kbd', null, 'esc'));
    back.addEventListener('click', function () { exit(); });
    top.appendChild(heading);
    top.appendChild(back);
    view.appendChild(top);

    var zoom = h('div', 'dcm-hud dcm-zoom');
    function zbtn(label, title, fn) {
      var b = mark(h('button', 'dcm-btn', label), 'control');
      b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('click', fn);
      zoom.appendChild(b);
    }
    var pct = h('span', 'dcm-pct', '100%');
    zbtn('−', 'Zoom out', function () { var p = portSize(state); zoomAt(state, 1 / 1.25, p.w / 2, p.h / 2, true); });
    zoom.appendChild(pct);
    zbtn('+', 'Zoom in', function () { var p = portSize(state); zoomAt(state, 1.25, p.w / 2, p.h / 2, true); });
    zoom.appendChild(h('span', 'dcm-sep'));
    zbtn('Fit', 'Fit all conversations (F)', function () { unfocus(); fit(state, true); });
    zbtn('Reset', 'Reading size (0)', function () { unfocus(); reset(state, true); });
    view.appendChild(zoom);

    view.appendChild(h('div', 'dcm-hud dcm-foot',
      'Grouped from the messages Discord has loaded: replies link messages, a 20-minute silence starts a new conversation, ' +
      'and long stretches split where the vocabulary changes. Labels are each conversation’s repeated words, not AI.'));

    var name = channelName();
    var st = state = {
      view: view, bg: bg, port: port, canvas: canvas, wires: wires, pct: pct, chat: chat,
      chatStyle: chat.getAttribute('style'), messages: messages, clusters: [], expanded: {}, focus: null,
      x: 0, y: 0, s: 1, listeners: [], closing: false,
    };
    view.style.visibility = 'hidden';
    document.body.appendChild(view);
    positionView();

    if (!messages.length) {
      view.appendChild(h('div', 'dcm-empty', 'No messages are loaded in this channel yet.'));
      zoom.style.display = 'none';
      view.querySelector('.dcm-foot').style.display = 'none';
      sub.textContent = '#' + name;
    } else {
      st.clusters = group(messages);
      sub.textContent = '#' + name + ' · ' + messages.length + ' loaded messages · ' +
        st.clusters.length + (st.clusters.length === 1 ? ' conversation' : ' conversations');
      var rootEl = mark(h('div', 'dcm-rootnode'), 'channel');
      var rn = h('div', 'dcm-rootname');
      rn.appendChild(h('b', null, '#'));
      rn.appendChild(document.createTextNode(name));
      rootEl.appendChild(rn);
      rootEl.appendChild(h('div', 'dcm-rootsub', st.clusters.length + (st.clusters.length === 1 ? ' conversation · ' : ' conversations · ') + span(messages)));
      canvas.appendChild(rootEl);
      st.rootEl = rootEl;
      st.clusters.forEach(function (c) { canvas.appendChild(buildCard(st, c)); });
      layout(st);
      fit(st, false);
    }

    toggle.classList.add('dcm-on');
    toggle.setAttribute('aria-pressed', 'true');
    wire(st);
    view.style.visibility = '';

    if (reduced || !messages.length) {
      view.classList.add('dcm-ready');
      chat.style.opacity = '0';
      port.focus({ preventScroll: true });
      return;
    }

    // 1. the stream softens
    chat.style.transition = 'opacity .28s ease, filter .28s ease';
    chat.style.opacity = '.4';
    chat.style.filter = 'saturate(.6)';
    // 2. the map's ground comes up under the moving messages
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 120, easing: 'ease-out', fill: 'backwards' });
    // 3. messages lift off the stream where they sit and travel to their
    //    conversation; ones scrolled out of view fade in place
    var clip = chat.getBoundingClientRect();
    var moved = 0;
    st.clusters.forEach(function (c, ci) {
      c.el.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, delay: 200 + ci * 30, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
      c.ordered.forEach(function (m) {
        if (!m.row) return;
        var to = m.row.getBoundingClientRect();
        var from = visibleRect(document.getElementById('message-content-' + m.id) || m.li, clip);
        if (from && moved < 40) {
          moved++;
          var dx = (from.left - to.left) / st.s, dy = (from.top - to.top) / st.s;
          m.row.animate([
            { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + (1 / st.s) + ')', opacity: 0.9, transformOrigin: '0 0' },
            { transform: 'none', opacity: 1, transformOrigin: '0 0' },
          ], { duration: 560, delay: 40 + moved * 12, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
        } else {
          m.row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay: 300 + ci * 30, easing: 'ease-out', fill: 'backwards' });
        }
      });
    });
    // 4. connections resolve
    [].forEach.call(canvas.querySelectorAll('svg path'), function (p) {
      p.animate([{ opacity: 0 }, { opacity: p.getAttribute('opacity') || 1 }], { duration: 300, delay: 480, easing: 'ease-out', fill: 'backwards' });
    });
    // 5. controls settle
    setTimeout(function () {
      if (state !== st) return;
      view.classList.add('dcm-ready');
      chat.style.opacity = '0';
      port.focus({ preventScroll: true });
    }, 620);
  }

  function exit(immediate, after) {
    if (!state || state.closing) return;
    var st = state;
    st.closing = true;
    st.listeners.forEach(function (off) { try { off(); } catch (e) {} });
    st.listeners = [];
    toggle.classList.remove('dcm-on');
    toggle.setAttribute('aria-pressed', 'false');

    function finish() {
      st.view.remove();
      if (st.chatStyle == null) st.chat.removeAttribute('style');
      else st.chat.setAttribute('style', st.chatStyle);
      if (state === st) state = null;
      if (after) after();
    }
    if (immediate || reduced || !st.chat.isConnected) { finish(); return; }

    // The reverse: controls go, the stream returns, messages fall back into it.
    st.view.classList.remove('dcm-ready');
    st.chat.style.transition = 'opacity .3s ease, filter .3s ease';
    st.chat.style.opacity = '1';
    st.chat.style.filter = '';
    st.bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 100, easing: 'ease-in', fill: 'forwards' });
    st.wires.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
    var clip = st.chat.getBoundingClientRect();
    var moved = 0;
    st.clusters.forEach(function (c) {
      c.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 120, easing: 'ease-in', fill: 'forwards' });
      c.ordered.forEach(function (m) {
        if (!m.row) return;
        var from = m.row.getBoundingClientRect();
        var to = visibleRect(document.getElementById('message-content-' + m.id) || m.li, clip);
        if (!to || moved++ > 40) return;
        var dx = (to.left - from.left) / st.s, dy = (to.top - from.top) / st.s;
        m.row.animate([
          { transform: 'none', opacity: 1, transformOrigin: '0 0' },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + (1 / st.s) + ')', opacity: 0, transformOrigin: '0 0' },
        ], { duration: 380, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
      });
    });
    setTimeout(finish, 440);
  }

  // Back to the stream, at the message itself. Discord keeps every message it
  // has loaded in the list, so the original node is scrolled to directly.
  function jump(m) {
    var li = document.getElementById(m.li.id);
    if (!li) {
      toast('That message is no longer loaded in Discord — scroll the channel back to it.');
      return;
    }
    exit(false, function () {
      li.scrollIntoView({ block: 'center' });
      requestAnimationFrame(function () { flash(li); });
    });
  }

  function flash(li) {
    if (!li.isConnected) return;
    var r = li.getBoundingClientRect();
    var f = mark(h('div', 'dcm-flash'), 'flash');
    f.style.left = r.left + 'px'; f.style.top = r.top + 'px';
    f.style.width = r.width + 'px'; f.style.height = r.height + 'px';
    document.body.appendChild(f);
    setTimeout(function () { f.style.opacity = '0'; }, 900);
    setTimeout(function () { f.remove(); }, 1900);
  }

  function toast(text) {
    var st = state;
    if (!st) return;
    var old = st.view.querySelector('.dcm-toast');
    if (old) old.remove();
    var t = h('div', 'dcm-toast', text);
    st.view.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 2600);
    setTimeout(function () { t.remove(); }, 3000);
  }

  function wire(st) {
    function listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      st.listeners.push(function () { target.removeEventListener(type, fn, opts); });
    }
    var port = st.port;

    // Drag anywhere to pan; a press that does not travel is still a click.
    var drag = null;
    var dragged = false;
    listen(port, 'pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, ox: st.x, oy: st.y, id: e.pointerId };
      dragged = false;
    });
    listen(window, 'pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!dragged) { dragged = true; port.classList.add('dcm-drag'); }
      st.x = drag.ox + dx; st.y = drag.oy + dy;
      apply(st, false);
    });
    listen(window, 'pointerup', function () {
      if (!drag) return;
      drag = null;
      port.classList.remove('dcm-drag');
    });
    // A drag's trailing click must not open a message or focus a card.
    listen(port, 'click', function (e) {
      if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; return; }
      var row = e.target.closest('.dcm-row');
      if (row) {
        e.stopPropagation();
        var id = row.getAttribute('data-id');
        var m = st.messages.filter(function (x) { return x.id === id; })[0];
        if (m) jump(m);
        return;
      }
      if (!e.target.closest('.dcm-card')) unfocus();
    }, true);

    // Trackpad and wheel: pinch (ctrl) zooms at the pointer, scrolling pans.
    listen(port, 'wheel', function (e) {
      e.preventDefault();
      var r = port.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(st, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)), e.clientX - r.left, e.clientY - r.top, false);
      } else {
        st.x -= e.deltaX; st.y -= e.deltaY;
        apply(st, false);
      }
    }, { passive: false });

    listen(st.view, 'keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (st.focus) unfocus(); else exit();
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('dcm-row')) {
        e.preventDefault(); e.target.click(); return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var p = portSize(st);
      if (e.key === 'f' || e.key === 'F') { unfocus(); fit(st, true); }
      else if (e.key === '0') { unfocus(); reset(st, true); }
      else if (e.key === '=' || e.key === '+') zoomAt(st, 1.25, p.w / 2, p.h / 2, true);
      else if (e.key === '-') zoomAt(st, 1 / 1.25, p.w / 2, p.h / 2, true);
      else return;
      e.preventDefault(); e.stopPropagation();
    });

    var ro = new ResizeObserver(positionView);
    ro.observe(st.chat);
    st.listeners.push(function () { ro.disconnect(); });
    listen(window, 'resize', positionView);
  }

  /* ------------------------------------------------------------ teardown */

  hooks[KEY] = function () {
    exit(true);
    cleanups.forEach(function (off) { try { off(); } catch (e) {} });
    cleanups = [];
    toggle.remove();
    style.remove();
    document.querySelectorAll('[data-modable^="discord-conversation-map"]').forEach(function (n) { n.remove(); });
    delete hooks[KEY];
  };

  return { ok: true, placed: toggle.isConnected };
})();
