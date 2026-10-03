/*
 * Slack Command Center — a Modable layer for the Slack desktop app.
 *
 * Re-reads the current channel's rendered messages as four operational groups
 * (decisions, action items, blockers, open questions) and puts the channel
 * back without touching it. The view is an overlay over the message pane; it
 * never writes to Slack's nodes, and the only native thing it changes is the
 * pane's inline style while open, which is saved and restored verbatim.
 *
 * Anchors, all read from the live DOM rather than hashed class names:
 *   [data-qa="message_pane"]                         what the view covers
 *   [data-qa="message_container"][data-msg-ts]       one rendered message
 *   [data-qa="message-text"]                         its text
 *   [data-qa="message_sender_name"]                  author, first of a run only
 *   a.c-timestamp  (aria-label, href)                time and permalink
 *   [data-qa="reply_bar_count"]                      "2 replies"
 *   [data-qa="view_header"] .p-view_header__actions  where the toggle sits
 *
 * Sorting is by plain phrase rules over each sentence, not a model. Every item
 * keeps the phrase that sorted it, and the view says so.
 *
 * Only the toggle and the stylesheet are claimed marks, because they are the
 * only nodes that exist straight after injection. Everything else is tagged
 * through mark() so it is not mistaken for proof the layer took.
 */
(function () {
  var KEY = 'slack-command-center';
  var ATTR = 'data-modable';
  var hooks = (window.__modableTeardown = window.__modableTeardown || {});

  // Injecting twice replaces the first copy rather than stacking a second.
  if (hooks[KEY]) { try { hooks[KEY](); } catch (e) {} }
  document.querySelectorAll('[data-modable^="slack-command-center"]').forEach(function (n) { n.remove(); });

  function paneEl() { return document.querySelector('[data-qa="message_pane"]'); }
  function actionsEl() { return document.querySelector('[data-qa="view_header"] .p-view_header__actions'); }

  if (!paneEl() || !actionsEl()) {
    return { ok: false, reason: 'Slack channel header or message pane not found' };
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cleanups = [];
  var state = null; // non-null while Command Center is open

  function mark(el, part) { el.setAttribute(ATTR, KEY + '-' + part); return el; }
  function h(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  /* ---------------------------------------------------------------- style */

  // Slack publishes its theme as "r, g, b" triples, so the view follows light
  // and dark (and custom themes) without reading either.
  var style = document.createElement('style');
  style.setAttribute('data-modable', 'slack-command-center-style');
  style.textContent = [
    '.scc-root{--scc-bg:rgb(var(--sk_primary_background,255,255,255));--scc-fg:rgb(var(--sk_primary_foreground,29,28,29));',
    ' --scc-max:rgb(var(--sk_foreground_max,29,28,29));--scc-line:rgba(var(--sk_foreground_max,29,28,29),.1);',
    ' --scc-line2:rgba(var(--sk_foreground_max,29,28,29),.06);--scc-hover:rgba(var(--sk_foreground_max,29,28,29),.045);',
    ' --scc-mute:rgba(var(--sk_primary_foreground,29,28,29),.62);--scc-faint:rgba(var(--sk_primary_foreground,29,28,29),.42)}',

    '.scc-toggle{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;margin-right:2px;border-radius:8px;',
    ' border:1px solid var(--scc-line);background:transparent;color:var(--scc-fg);font:inherit;font-size:13px;font-weight:700;',
    ' line-height:1;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,color .12s}',
    '.scc-toggle:hover{background:var(--scc-hover);border-color:rgba(var(--sk_foreground_max,29,28,29),.18)}',
    '.scc-toggle:focus-visible{outline:2px solid var(--scc-accent);outline-offset:1px}',
    '.scc-toggle svg{width:14px;height:14px;flex:none;opacity:.85}',
    '.scc-toggle.scc-on{color:var(--scc-accent);border-color:var(--scc-accent-line);background:var(--scc-accent-soft)}',

    '.scc-view{position:fixed;z-index:60;overflow:hidden;font-family:inherit;color:var(--scc-fg);-webkit-font-smoothing:antialiased}',
    '.scc-bg{position:absolute;inset:0;background:var(--scc-bg)}',
    '.scc-scroll{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;outline:none}',
    '.scc-inner{max-width:1040px;margin:0 auto;padding:18px 28px 28px}',

    '.scc-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:2px 0 16px;',
    ' border-bottom:1px solid var(--scc-line2);margin-bottom:18px}',
    '.scc-title{margin:0;font-size:18px;font-weight:900;letter-spacing:-.01em;color:var(--scc-max);display:flex;align-items:center;gap:8px}',
    '.scc-title i{display:block;width:7px;height:7px;border-radius:2px;background:var(--scc-accent)}',
    '.scc-sub{margin:4px 0 0;font-size:13px;color:var(--scc-mute)}',
    '.scc-back{flex:none;height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--scc-line);background:transparent;',
    ' color:var(--scc-fg);font:inherit;font-size:13px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
    '.scc-back:hover{background:var(--scc-hover)}',
    '.scc-back:focus-visible,.scc-item:focus-visible{outline:2px solid var(--scc-accent);outline-offset:-2px}',
    '.scc-back kbd{font:inherit;font-size:11px;font-weight:400;color:var(--scc-faint)}',

    '.scc-grid{display:grid;grid-template-columns:1fr;gap:26px 40px}',
    '.scc-wide .scc-grid{grid-template-columns:1fr 1fr}',
    '.scc-sh{display:flex;align-items:center;gap:8px;margin:0 0 6px;padding:0 10px;font-size:11.5px;font-weight:700;',
    ' letter-spacing:.07em;text-transform:uppercase;color:var(--scc-mute)}',
    '.scc-dot{width:6px;height:6px;border-radius:50%;flex:none}',
    '.scc-count{margin-left:auto;font-weight:400;letter-spacing:0;font-variant-numeric:tabular-nums;color:var(--scc-faint)}',
    '.scc-empty{padding:9px 10px;font-size:13px;color:var(--scc-faint)}',

    '.scc-item{position:relative;display:block;padding:9px 10px 9px 10px;border-radius:8px;cursor:pointer;color:inherit;text-decoration:none}',
    '.scc-item+.scc-item{box-shadow:0 -1px 0 var(--scc-line2)}',
    '.scc-item:hover{background:var(--scc-hover);box-shadow:none}',
    '.scc-item:hover+.scc-item{box-shadow:none}',
    '.scc-text{font-size:15px;line-height:1.42;color:var(--scc-max);overflow-wrap:anywhere;',
    ' display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}',
    '.scc-meta{display:flex;align-items:center;flex-wrap:wrap;gap:0 6px;margin-top:3px;font-size:12.5px;color:var(--scc-mute)}',
    '.scc-author{font-weight:700;color:var(--scc-fg)}',
    '.scc-sep{color:var(--scc-faint)}',
    '.scc-tag{padding:0 5px;border-radius:4px;background:var(--scc-line2);font-size:11.5px;line-height:17px}',
    '.scc-owner{color:var(--scc-accent)}',
    '.scc-jump{margin-left:auto;font-size:12px;color:var(--scc-faint);opacity:0;transition:opacity .12s}',
    '.scc-item:hover .scc-jump,.scc-item:focus-visible .scc-jump{opacity:1}',
    '.scc-new{animation:scc-new 1.6s ease-out}',
    '@keyframes scc-new{0%{background:var(--scc-accent-soft)}100%{background:transparent}}',

    '.scc-foot{margin-top:28px;padding-top:12px;border-top:1px solid var(--scc-line2);font-size:12px;color:var(--scc-faint)}',
    '.scc-chrome{transition:opacity .22s ease,transform .22s ease}',
    '.scc-view:not(.scc-ready) .scc-chrome{opacity:0;transform:translateY(-3px)}',

    '.scc-flash{position:fixed;z-index:59;pointer-events:none;border-radius:6px;background:var(--scc-accent-soft);',
    ' box-shadow:inset 2px 0 0 var(--scc-accent);transition:opacity .9s ease}',
  ].join('\n');
  document.head.appendChild(style);

  var GROUPS = [
    { id: 'decisions', label: 'Decisions', color: '#2bac76', empty: 'No decisions in the loaded messages' },
    { id: 'actions', label: 'Action items', color: 'var(--scc-accent)', empty: 'No action items in the loaded messages' },
    { id: 'blockers', label: 'Blockers', color: '#e0533f', empty: 'Nothing blocked in the loaded messages' },
    { id: 'questions', label: 'Open questions', color: '#e8a33d', empty: 'No open questions in the loaded messages' },
  ];

  /* -------------------------------------------------------------- theme */

  function isDark() {
    if (document.body.classList.contains('sk-client-theme--dark')) return true;
    var m = getComputedStyle(document.body).getPropertyValue('--sk_primary_background').match(/\d+/g);
    return !!m && (+m[0] * 0.299 + +m[1] * 0.587 + +m[2] * 0.114) < 128;
  }
  function applyTheme(el) {
    var dark = isDark();
    el.classList.add('scc-root');
    el.style.setProperty('--scc-accent', dark ? 'hsl(205 66% 66%)' : 'hsl(205 62% 44%)');
    el.style.setProperty('--scc-accent-soft', dark ? 'hsla(205,66%,66%,.14)' : 'hsla(205,62%,44%,.1)');
    el.style.setProperty('--scc-accent-line', dark ? 'hsla(205,66%,66%,.45)' : 'hsla(205,62%,44%,.4)');
  }

  /* --------------------------------------------------------------- toggle */

  function icon() {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    [['2', '2.5', '5', '4.5'], ['9', '2.5', '5', '4.5'], ['2', '9', '5', '4.5'], ['9', '9', '5', '4.5']].forEach(function (r) {
      var rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', r[0]); rect.setAttribute('y', r[1]);
      rect.setAttribute('width', r[2]); rect.setAttribute('height', r[3]); rect.setAttribute('rx', '1.2');
      svg.appendChild(rect);
    });
    return svg;
  }

  var toggle = document.createElement('button');
  toggle.setAttribute('data-modable', 'slack-command-center-toggle');
  toggle.type = 'button';
  toggle.className = 'scc-toggle';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.setAttribute('title', 'Command Center — this channel as decisions, actions, blockers and questions');
  toggle.appendChild(icon());
  toggle.appendChild(h('span', null, 'Command Center'));
  toggle.addEventListener('click', function () { state ? exit() : enter(); });
  applyTheme(toggle);

  // First in Slack's header action row, so it inherits its spacing and sits
  // before the huddle and notification buttons.
  function placeToggle() {
    var row = actionsEl();
    if (!row) return false;
    row.insertBefore(toggle, row.firstChild);
    return true;
  }
  if (!placeToggle()) { style.remove(); return { ok: false, reason: 'no place for the Command Center control' }; }

  // Slack re-renders the header when the channel changes. Put the control
  // back, and leave Command Center if the channel under it changed. Scoped to
  // the workspace layout rather than the whole document.
  var href = location.href;
  var scope = document.querySelector('.p-client_workspace__layout') || document.querySelector('.p-client_workspace') || document.body;
  var mo = new MutationObserver(function () {
    if (location.href !== href) {
      href = location.href;
      if (state) exit(true);
    }
    if (!toggle.isConnected) { placeToggle(); applyTheme(toggle); }
  });
  mo.observe(scope, { childList: true, subtree: true });
  cleanups.push(function () { mo.disconnect(); });

  /* -------------------------------------------------------- read channel */

  function channelName() {
    var n = document.querySelector('[data-qa="channel_name"]');
    return n ? n.textContent.trim() : '';
  }

  // What the rendered DOM actually holds. Slack prints a sender's name only on
  // the first message of a run from that sender; a message without one belongs
  // to the run above it. A run whose start is not rendered stays unattributed.
  function readMessages(pane) {
    var out = [];
    var prev = null;
    pane.querySelectorAll('[data-qa="message_container"]').forEach(function (m) {
      if (m.getAttribute('data-qa-placeholder') === 'true') { prev = null; return; }
      var ts = m.getAttribute('data-msg-ts');
      var textEl = m.querySelector('[data-qa="message-text"]');
      if (!ts || !textEl) { prev = null; return; }

      var nameEl = m.querySelector('[data-qa="message_sender_name"]');
      var author = nameEl ? nameEl.textContent.trim() : '';
      if (!author) {
        var hidden = m.querySelector('[id$="-sender"]');
        if (hidden) author = hidden.textContent.replace(/:\s*$/, '').trim();
      }
      if (!author && prev) author = prev.author;

      var stamp = m.querySelector('a.c-timestamp');
      var replies = m.querySelector('[data-qa="reply_bar_count"]');
      var mentions = [];
      textEl.querySelectorAll('[data-stringify-type="mention"], .c-member_slug').forEach(function (x) {
        var t = x.textContent.trim();
        if (t && mentions.indexOf(t) < 0) mentions.push(t);
      });

      var msg = {
        ts: ts,
        channel: m.getAttribute('data-msg-channel-id') || '',
        el: m,
        author: author,
        when: stamp ? (stamp.getAttribute('aria-label') || '').replace(/(\d+:\d+):\d+/, '$1').replace(/^(Today|Yesterday) at /, '$1 ') : '',
        href: stamp ? stamp.getAttribute('href') || '' : '',
        replies: replies ? replies.textContent.trim() : '',
        mentions: mentions,
        text: textEl.innerText.replace(/ /g, ' ').trim(),
      };
      out.push(msg);
      prev = msg;
    });
    return out;
  }

  /* ------------------------------------------------------------- sorting */

  // Order matters: a sentence lands in the first group whose rule it meets, so
  // "Blocked until someone answers?" is a blocker before it is a question.
  var RULES = [
    ['blockers', [
      /\bblock(?:ed|er|ers|ing)\b/i,
      /\bwaiting (?:on|for)\b/i,
      /\b(?:can['’]?t|cannot|unable to)\b[^.]*\buntil\b/i,
      /\bstuck (?:on|with)\b/i,
      /\bon hold\b/i,
      /\bheld up\b/i,
      /\b(?:can['’]?t|cannot) \w+ yet\b/i,
    ]],
    ['questions', [
      /\?\s*$/,
    ]],
    ['decisions', [
      /^\s*(?:decision|decided|final call|resolved)\s*[:\-—]/i,
      /\blet['’]?s (?:use|go with|ship|launch|stick with|move forward|keep|drop)\b/i,
      /\bwe['’]?(?:re| are| will|ll) (?:going with|shipping|launching|using|moving forward|sticking with)\b/i,
      /\b(?:we|team) (?:decided|agreed|chose)\b/i,
      /\b(?:is|are|was|were|has been|have been|got) (?:approved|signed off|finali[sz]ed|locked in)\b/i,
      /\bis (?:still )?the (?:\w+ )?(?:target|plan|date|decision|call)\b/i,
      /\bgoing with\b/i,
    ]],
    ['actions', [
      /^\s*(?:todo|to-do|action item|ai)\s*[:\-—]/i,
      /\bplease\b/i,
      /\b(?:someone|we|you|i) (?:needs?|have|has) to\b/i,
      /\bneeds? to (?:be )?(?:fix|test|update|finish|ship|review|write|check|verify|send|build|add)\w*\b/i,
      /\bI['’]?(?:ll| will| am going to|'m going to|’m going to)\b/i,
      /\b(?:can|could) you\b/i,
      /\bwill (?:handle|fix|update|take|own|finish|look into|send|write|review)\b/i,
      /\bby (?:tomorrow|tonight|eod|end of day|monday|tuesday|wednesday|thursday|friday|next week)\b/i,
    ]],
  ];

  function sentences(text) {
    var parts = [];
    text.split(/\n+/).forEach(function (line) {
      line.split(/(?<=[.!?])\s+(?=["“'‘(@A-Z0-9])/).forEach(function (s) {
        s = s.replace(/^[\s•\-–*]+/, '').trim();
        if (s.split(/\s+/).length >= 3) parts.push(s);
      });
    });
    return parts;
  }

  function classify(sentence) {
    for (var i = 0; i < RULES.length; i++) {
      var rules = RULES[i][1];
      for (var j = 0; j < rules.length; j++) {
        var m = sentence.match(rules[j]);
        if (m) return { group: RULES[i][0], cue: m[0].trim() };
      }
    }
    return null;
  }

  // Owner only when the words say so: an @mention in the sentence, or "I'll"
  // from a known author. Never guessed from a bare name.
  function ownerOf(sentence, msg) {
    for (var i = 0; i < msg.mentions.length; i++) if (sentence.indexOf(msg.mentions[i]) >= 0) return msg.mentions[i];
    if (msg.author && /\bI['’]?(?:ll| will| am going to|'m going to|’m going to)\b/i.test(sentence)) return msg.author;
    return '';
  }

  function sort(messages) {
    var groups = { decisions: [], actions: [], blockers: [], questions: [] };
    var seen = {};
    var used = 0;
    messages.forEach(function (msg) {
      var hit = false;
      sentences(msg.text).forEach(function (s, i) {
        var c = classify(s);
        if (!c) return;
        hit = true;
        var dupKey = c.group + '|' + s.toLowerCase().replace(/\W+/g, ' ').trim();
        if (seen[dupKey]) {
          // Same words posted again: one row, pointing at the latest copy.
          var d = seen[dupKey];
          d.copies++;
          d.msg = msg;
          d.key = msg.ts + ':' + i;
          return;
        }
        var item = {
          key: msg.ts + ':' + i, id: dupKey, group: c.group, cue: c.cue, text: s, msg: msg,
          owner: c.group === 'actions' ? ownerOf(s, msg) : '', copies: 1,
        };
        seen[dupKey] = item;
        groups[c.group].push(item);
      });
      if (hit) used++;
    });
    // Newest first, the way an operational view is read.
    Object.keys(groups).forEach(function (k) { groups[k].sort(function (a, b) { return +b.msg.ts - +a.msg.ts; }); });
    return { groups: groups, used: used, total: messages.length };
  }

  /* ---------------------------------------------------------------- view */

  function buildItem(item) {
    var el = mark(h('a', 'scc-item'), 'item');
    if (item.msg.href) el.href = item.msg.href;
    el.setAttribute('role', 'button');
    el.setAttribute('title', 'Sorted by the phrase “' + item.cue + '” · open in channel');
    el.appendChild(h('div', 'scc-text', item.text));
    var meta = h('div', 'scc-meta');
    function add(node) {
      if (meta.childNodes.length) meta.appendChild(h('span', 'scc-sep', '·'));
      meta.appendChild(node);
    }
    if (item.msg.author) add(h('span', 'scc-author', item.msg.author));
    if (item.msg.when) add(h('span', null, item.msg.when));
    if (item.owner) add(h('span', 'scc-owner', item.owner === item.msg.author ? 'taking it' : '→ ' + item.owner));
    if (item.msg.replies) add(h('span', 'scc-tag', item.msg.replies));
    if (item.copies > 1) add(h('span', 'scc-tag', 'posted ' + item.copies + '×'));
    meta.appendChild(h('span', 'scc-jump', 'Jump to message ↵'));
    el.appendChild(meta);
    el.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey) return; // let Slack open the permalink itself
      e.preventDefault();
      jump(item);
    });
    item.el = el;
    return el;
  }

  function renderGroups(st, sorted, fresh) {
    st.grid.textContent = '';
    st.items = [];
    GROUPS.forEach(function (g) {
      var list = sorted.groups[g.id];
      var sec = mark(h('section', 'scc-sec'), 'section');
      var head = h('div', 'scc-sh scc-chrome');
      var dot = h('span', 'scc-dot'); dot.style.background = g.color;
      head.appendChild(dot);
      head.appendChild(h('span', null, g.label));
      head.appendChild(h('span', 'scc-count', String(list.length)));
      sec.appendChild(head);
      if (!list.length) sec.appendChild(h('div', 'scc-empty scc-chrome', g.empty));
      list.forEach(function (item) {
        sec.appendChild(buildItem(item));
        if (fresh && !fresh[item.id]) item.el.classList.add('scc-new');
        st.items.push(item);
      });
      st.grid.appendChild(sec);
    });
    var n = channelName();
    st.sub.textContent = (n ? '#' + n + ' · ' : '') + sorted.used + ' of ' + sorted.total + ' loaded messages sorted';
  }

  function positionView() {
    if (!state) return;
    var pane = paneEl();
    if (!pane) { exit(true); return; }
    var r = pane.getBoundingClientRect();
    var v = state.view.style;
    v.left = r.left + 'px'; v.top = r.top + 'px'; v.width = r.width + 'px'; v.height = r.height + 'px';
    state.view.classList.toggle('scc-wide', r.width >= 760);
  }

  // The sentence's own line inside its message, so a long multi-line post
  // points at the right line rather than the whole post. Falls back to the
  // message text when the sentence spans formatting and is not one text node.
  function lineRect(msgEl, sentence) {
    var textEl = msgEl.querySelector('[data-qa="message-text"]') || msgEl;
    var probe = sentence.slice(0, 32);
    var walk = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
    for (var n = walk.nextNode(); n; n = walk.nextNode()) {
      var at = n.data.replace(/ /g, ' ').indexOf(probe);
      if (at < 0) continue;
      var range = document.createRange();
      range.setStart(n, at);
      range.setEnd(n, Math.min(n.data.length, at + sentence.length));
      var r = range.getBoundingClientRect();
      if (r.height) return r;
    }
    return textEl.getBoundingClientRect();
  }

  // An item's place in the stream, if it is on screen now.
  function sourceRect(item) {
    var msg = item.msg;
    var el = msg.el && msg.el.isConnected ? msg.el : findMessage(msg);
    if (!el) return null;
    var r = lineRect(el, item.text);
    var p = state.paneRect;
    if (!r.height || r.bottom < p.top || r.top > p.bottom) return null;
    return r;
  }
  function findMessage(msg) {
    var pane = paneEl();
    return pane && pane.querySelector('[data-qa="message_container"][data-msg-ts="' + msg.ts + '"]');
  }

  function enter() {
    if (state) return;
    var pane = paneEl();
    if (!pane) return;
    var messages = readMessages(pane);
    var sorted = sort(messages);

    var view = mark(h('div', 'scc-view'), 'view');
    applyTheme(view);
    var bg = mark(h('div', 'scc-bg'), 'bg');
    var scroll = mark(h('div', 'scc-scroll'), 'scroll');
    scroll.tabIndex = -1;
    var inner = h('div', 'scc-inner');
    var top = h('div', 'scc-top scc-chrome');
    var titles = h('div');
    var title = h('h2', 'scc-title');
    title.appendChild(h('i'));
    title.appendChild(document.createTextNode('Command Center'));
    titles.appendChild(title);
    var sub = h('p', 'scc-sub');
    titles.appendChild(sub);
    var back = mark(h('button', 'scc-back'), 'back');
    back.type = 'button';
    back.appendChild(document.createTextNode('Back to Messages'));
    back.appendChild(h('kbd', null, 'esc'));
    back.addEventListener('click', function () { exit(); });
    top.appendChild(titles);
    top.appendChild(back);
    var grid = h('div', 'scc-grid');
    var foot = h('div', 'scc-foot scc-chrome',
      'Sorted by phrase rules over the messages Slack has loaded in this channel — not by AI. ' +
      'Hover an item to see the phrase that placed it. Nothing in Slack is changed.');
    inner.appendChild(top);
    inner.appendChild(grid);
    inner.appendChild(foot);
    scroll.appendChild(inner);
    view.appendChild(bg);
    view.appendChild(scroll);

    state = {
      view: view, bg: bg, scroll: scroll, grid: grid, sub: sub, pane: pane, items: [],
      paneStyle: pane.getAttribute('style'), paneRect: pane.getBoundingClientRect(),
      listeners: [], closing: false,
    };
    renderGroups(state, sorted, null);
    document.body.appendChild(view);
    positionView();

    toggle.classList.add('scc-on');
    toggle.setAttribute('aria-pressed', 'true');

    wire();

    if (reduced) {
      view.classList.add('scc-ready');
      pane.style.opacity = '0';
      scroll.focus({ preventScroll: true });
      return;
    }

    // 1. the stream softens
    pane.style.transition = 'opacity .26s ease, filter .26s ease';
    pane.style.opacity = '.38';
    pane.style.filter = 'saturate(.6)';
    // 2. the page behind the groups fades in under the moving items
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: 140, easing: 'ease-out', fill: 'backwards' });
    // 3. useful messages lift off where they sit and settle into their group
    state.items.forEach(function (item, i) {
      var to = item.el.getBoundingClientRect();
      var from = sourceRect(item);
      var dx = from ? from.left - to.left : 0;
      var dy = from ? from.top - to.top : 14;
      item.el.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: from ? 0.55 : 0 },
        { opacity: 1, offset: 0.35 },
        { transform: 'none', opacity: 1 },
      ], { duration: 520, delay: 60 + Math.min(i * 24, 200), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
    // 4–5. it settles, then the headings and controls appear
    setTimeout(function () {
      if (!state || state.view !== view) return;
      view.classList.add('scc-ready');
      pane.style.opacity = '0';
      scroll.focus({ preventScroll: true });
    }, 520);
  }

  function exit(immediate, after) {
    if (!state || state.closing) return;
    var st = state;
    st.closing = true;
    st.listeners.forEach(function (off) { try { off(); } catch (e) {} });
    st.listeners = [];

    toggle.classList.remove('scc-on');
    toggle.setAttribute('aria-pressed', 'false');

    function finish() {
      st.view.remove();
      if (st.paneStyle == null) st.pane.removeAttribute('style');
      else st.pane.setAttribute('style', st.paneStyle);
      if (state === st) state = null;
      if (after) after();
    }
    if (immediate || reduced) { finish(); return; }

    // The reverse: controls go, the stream returns, items fall back into it.
    st.view.classList.remove('scc-ready');
    st.pane.style.transition = 'opacity .3s ease, filter .3s ease';
    st.pane.style.opacity = '1';
    st.pane.style.filter = '';
    st.bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 80, easing: 'ease-in', fill: 'forwards' });
    st.paneRect = st.pane.getBoundingClientRect();
    st.items.forEach(function (item, i) {
      var from = item.el.getBoundingClientRect();
      var to = sourceRect(item);
      var dx = to ? to.left - from.left : 0;
      var dy = to ? to.top - from.top : 10;
      item.el.animate([
        { transform: 'none', opacity: 1 },
        { opacity: to ? 0.6 : 0, offset: 0.7 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px)', opacity: 0 },
      ], { duration: 380, delay: Math.min(i * 14, 110), easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    });
    setTimeout(finish, 500);
  }

  // Back to the stream, at the message the item came from.
  function jump(item) {
    var el = findMessage(item.msg);
    if (!el) {
      // Scrolled out of what Slack keeps rendered: hand the real permalink to
      // Slack, which knows how to load and open it.
      exit(false, function () { if (item.msg.href) window.open(item.msg.href); });
      return;
    }
    // Scroll first, under the cover of the view, so the item lands on its line.
    el.scrollIntoView({ block: 'center' });
    var scroller = el.parentElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
      scroller = scroller.parentElement;
    }
    if (scroller) {
      var line = lineRect(el, item.text);
      var box = scroller.getBoundingClientRect();
      scroller.scrollTop += (line.top + line.height / 2) - (box.top + box.height / 2);
    }
    exit(false, function () { flash(el, item.text); });
  }

  function flash(el, text) {
    if (!el.isConnected) return;
    var r = lineRect(el, text);
    r = { left: r.left - 6, top: r.top - 3, width: r.width + 12, height: r.height + 6 };
    var f = mark(h('div', 'scc-flash'), 'flash');
    applyTheme(f);
    f.style.left = r.left + 'px'; f.style.top = r.top + 'px';
    f.style.width = r.width + 'px'; f.style.height = r.height + 'px';
    document.body.appendChild(f);
    setTimeout(function () { f.style.opacity = '0'; }, 700);
    setTimeout(function () { f.remove(); }, 1700);
  }

  function wire() {
    var st = state;
    function listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      st.listeners.push(function () { target.removeEventListener(type, fn, opts); });
    }
    listen(st.view, 'keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exit(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('scc-item')) {
        e.preventDefault();
        e.target.click();
      }
    });
    var ro = new ResizeObserver(positionView);
    ro.observe(st.pane);
    st.listeners.push(function () { ro.disconnect(); });
    listen(window, 'resize', positionView);

    // New messages while open: re-read and re-sort, debounced, watching only
    // the pane. Rows that were not there before get a brief highlight.
    var timer = 0;
    var watch = new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (state !== st || st.closing) return;
        var before = {};
        st.items.forEach(function (it) { before[it.id] = true; });
        var sorted = sort(readMessages(st.pane));
        var changed = st.items.length !== Object.keys(sorted.groups).reduce(function (n, k) { return n + sorted.groups[k].length; }, 0) ||
          Object.keys(sorted.groups).some(function (k) { return sorted.groups[k].some(function (it) { return !before[it.id]; }); });
        if (!changed) return;
        var y = st.scroll.scrollTop;
        renderGroups(st, sorted, before);
        st.scroll.scrollTop = y;
      }, 300);
    });
    watch.observe(st.pane, { childList: true, subtree: true });
    st.listeners.push(function () { watch.disconnect(); clearTimeout(timer); });
  }

  /* ------------------------------------------------------------ teardown */

  hooks[KEY] = function () {
    exit(true);
    cleanups.forEach(function (off) { try { off(); } catch (e) {} });
    cleanups = [];
    toggle.remove();
    style.remove();
    document.querySelectorAll('[data-modable^="slack-command-center"]').forEach(function (n) { n.remove(); });
    delete hooks[KEY];
  };

  return { ok: true, placed: toggle.isConnected };
})();
