/**
 * Cross-app handoff: Discord → Notion.
 *
 * Every app runs under its own debugging session (lib/sessions.js), so Notion
 * and Discord are both reachable at once: Discord stays exactly as it is — a
 * Ghost Channel lives only in its window — while Notion is found, or started,
 * on a session of its own. The handoff is still sequential: Discord is read
 * and the project is stored in Modable before Notion is touched.
 *
 * Three jobs live here:
 *  - notionTarget(): Notion's session (started if it has none) and its real
 *    document window — never the hidden /blank page, the 36px tab bar, or a
 *    utility window.
 *  - the source bridge: Notion will not hand a discord:// link to the OS
 *    (window.open, anchors and location are all refused), so the project layer
 *    calls a CDP binding instead. The binding reaches this process, which opens
 *    the link with macOS `open` — Discord's own deep link, verified to jump to
 *    the exact message — and briefly highlights it over Discord's debugger.
 *  - reveal(): bring Notion forward once the project has landed in it.
 */
const { execFile } = require('child_process');
const WebSocket = require('ws');

const NOTION_APP = '/Applications/Notion.app';
const DISCORD_APP = '/Applications/Discord.app';
const BINDING = '__modableOpenSource';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/*
 * Runs inside each Notion page target: what kind of window is this? Only a
 * window showing a document frame is a destination. Quick search and the tab
 * bar have no .notion-frame; the restore page is 0×0.
 *
 * visibilityState alone cannot decide it: macOS reports a window covered by
 * another one (Modable's, during the handoff) as hidden. So a visible window
 * wins, then the focused one (Notion's active tab), then the largest.
 */
const DESCRIBE = `(function(){
  var frame = document.querySelector('.notion-frame');
  var title = document.querySelector('.notion-frame h1');
  return {
    visible: document.visibilityState === 'visible',
    focus: document.hasFocus(),
    w: innerWidth, h: innerHeight,
    frame: !!frame,
    content: !!document.querySelector('.notion-page-content'),
    topbar: !!document.querySelector('.notion-topbar-action-buttons'),
    title: (title && title.textContent || document.title || '').trim().slice(0, 120),
    dark: !!(document.body && document.body.classList.contains('notion-dark-theme'))
  };
})()`;

/**
 * @param {Array} pages CDP /json listing
 * @param {Object<string, object>} described DESCRIBE result per target id
 */
function pickNotionDocument(pages, described) {
  let best = null;
  let bestScore = -1;
  for (const p of pages || []) {
    if (p.type !== 'page' || !p.webSocketDebuggerUrl) continue;
    if (!/^https:\/\/(?:app\.notion\.com|www\.notion\.so|notion\.so)\//.test(p.url || '')) continue;
    if (/\/blank(?:[?#]|$)/.test(p.url)) continue;
    const d = described[p.id];
    if (!d || !d.frame || !d.topbar) continue;
    if (d.w < 480 || d.h < 320) continue;
    const score = (d.visible ? 2e8 : 0) + (d.focus ? 1e8 : 0) + Math.min(d.w * d.h, 9e7);
    if (score > bestScore) { best = { page: p, info: d }; bestScore = score; }
  }
  return best;
}

function createHandoff({ cdpEvaluate, sessions }) {
  /* ------------------------------------------------------------ Notion */

  async function describeAll(pages) {
    const described = {};
    await Promise.all(pages
      .filter(p => p.type === 'page' && p.webSocketDebuggerUrl)
      .map(async p => {
        const out = await cdpEvaluate(p.webSocketDebuggerUrl, DESCRIBE, 1500);
        if (out.success && out.result) described[p.id] = out.result;
      }));
    return described;
  }

  const handed = new Set();

  /**
   * Notion's document window, starting a Notion session if it has none.
   * Never returns some other window: no document, no target.
   */
  async function notionTarget({ launch = true, timeout = 30000 } = {}) {
    let port = sessions.portFor(NOTION_APP);
    if (!port) {
      if (!launch) return { success: false, error: 'Notion is not running with Modable.' };
      port = (await sessions.ensure(NOTION_APP)).port;
    }

    const t0 = Date.now();
    let lastSeen = 'Notion did not open a window.';
    while (Date.now() - t0 < timeout) {
      let pages = null;
      try { pages = await sessions.pages(port); } catch { pages = null; }
      if (pages) {
        const described = await describeAll(pages);
        const best = pickNotionDocument(pages, described);
        if (best) {
          handed.add(best.page.id);
          attachBridge(best.page);
          return {
            success: true,
            targetId: best.page.id,
            title: best.info.title,
            url: best.page.url,
            dark: best.info.dark,
            port,
          };
        }
        const shown = Object.values(described).filter(d => d.w > 400);
        lastSeen = shown.length
          ? 'Notion is open but is not showing a page. Open the page the project should go on.'
          : 'Notion did not finish starting.';
      } else if (sessions.portFor(NOTION_APP) !== port) {
        return { success: false, error: 'Notion closed before Modable could reach it.' };
      }
      await sleep(600);
    }
    return { success: false, error: lastSeen };
  }

  /* ------------------------------------------------------- source bridge */

  let bridge = null; // { id, ws, seq }

  function attachBridge(page) {
    if (bridge && bridge.id === page.id && bridge.ws.readyState <= WebSocket.OPEN) return;
    if (bridge) { try { bridge.ws.close(); } catch {} }
    const ws = new WebSocket(page.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    const b = { id: page.id, ws, seq: 100 };
    bridge = b;
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.addBinding', params: { name: BINDING } }));
      console.log(`[Modable] Source bridge listening in Notion [${page.id}]`);
    });
    ws.on('message', data => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === BINDING) {
        onSourceRequest(b, msg.params.payload);
      }
    });
    ws.on('close', () => { if (bridge === b) bridge = null; });
    ws.on('error', () => {});
  }

  function ack(b, requestId, result) {
    if (!b.ws || b.ws.readyState !== WebSocket.OPEN) return;
    const payload = JSON.stringify({ requestId, ...result }).replace(/</g, '\\u003c');
    b.ws.send(JSON.stringify({
      id: ++b.seq,
      method: 'Runtime.evaluate',
      params: { expression: `window.__modableSourceAck && window.__modableSourceAck(${payload})` },
    }));
  }

  /** Discord's own window in its session, when it has one. */
  async function discordPage() {
    const port = sessions.portFor(DISCORD_APP);
    if (!port) return null;
    try {
      const pages = await sessions.pages(port, 1500);
      return pages.find(p => p.type === 'page' && /discord\.com\/channels\//.test(p.url || '') && p.webSocketDebuggerUrl) || null;
    } catch {
      return null;
    }
  }

  /*
   * Runs inside Discord after the deep link: wait for the message, centre it,
   * and give it a brief highlight. element.animate leaves nothing behind in
   * Discord's DOM — no class, no attribute, no node.
   *
   * The popstate first: Discord's router re-reads the location it is already
   * at (a no-op for it), and a Ghost Channel view open over the chat closes,
   * as it does whenever Discord moves somewhere it did not take it — otherwise
   * the jumped-to message would sit hidden behind it.
   */
  function highlightScript(channelId, messageId) {
    return `(function(c, m){
      try { dispatchEvent(new PopStateEvent('popstate', { state: history.state })); } catch (e) {}
      return new Promise(function (resolve) {
        var t0 = Date.now();
        (function look() {
          var onChannel = location.pathname.split('/')[3] === c;
          var li = m ? document.getElementById('chat-messages-' + c + '-' + m) : null;
          if (onChannel && (li || !m)) {
            if (li) {
              li.scrollIntoView({ block: 'center' });
              var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
              li.animate([
                { boxShadow: 'inset 3px 0 0 #5865f2', backgroundColor: 'rgba(88,101,242,.22)' },
                { boxShadow: 'inset 3px 0 0 #5865f2', backgroundColor: 'rgba(88,101,242,.22)', offset: .6 },
                { boxShadow: 'inset 3px 0 0 transparent', backgroundColor: 'transparent' }
              ], { duration: reduced ? 900 : 2200, easing: 'ease-out' });
            }
            return resolve({ channel: true, message: !!li });
          }
          if (Date.now() - t0 > 7000) return resolve({ channel: onChannel, message: false });
          setTimeout(look, 150);
        })();
      });
    })(${JSON.stringify(channelId)}, ${JSON.stringify(messageId || '')})`;
  }

  const ID = /^\d{5,25}$/;

  async function openSource(src) {
    const serverId = src.serverId === '@me' ? '@me' : String(src.serverId || '');
    const channelId = String(src.channelId || '');
    const messageId = src.messageId ? String(src.messageId) : '';
    if (!(serverId === '@me' || ID.test(serverId)) || !ID.test(channelId) || (messageId && !ID.test(messageId))) {
      return { ok: false, error: 'This item has no Discord location to open.' };
    }
    const url = `discord://-/channels/${serverId}/${channelId}${messageId ? '/' + messageId : ''}`;
    // Discord's own deep link: brings Discord forward (launching it if it is
    // closed) and routes to the message the way a message link does.
    const opened = await new Promise(resolve => execFile('open', [url], err => resolve(!err)));
    if (!opened) return { ok: false, error: 'macOS would not open the Discord link.' };

    const page = await discordPage();
    if (!page) {
      return { ok: true, exact: false, highlighted: false, note: 'Opened in Discord.' };
    }
    const out = await cdpEvaluate(page.webSocketDebuggerUrl, highlightScript(channelId, messageId), 9000);
    const r = (out.success && out.result) || {};
    return {
      ok: true,
      exact: !!r.message,
      highlighted: !!r.message,
      note: r.message ? 'Opened in Discord.' :
        r.channel ? 'Opened the channel — Discord could not load that exact message.' :
        'Opened in Discord.',
    };
  }

  async function onSourceRequest(b, raw) {
    let req;
    try { req = JSON.parse(raw); } catch { return; }
    const requestId = String(req.requestId || '');
    if (req.app !== 'discord') return ack(b, requestId, { ok: false, error: 'Unknown source.' });
    try {
      const result = await openSource(req);
      console.log(`[Modable] Source → Discord ${req.channelId}/${req.messageId || '-'}: ${result.ok ? (result.exact ? 'exact message' : 'channel') : result.error}`);
      ack(b, requestId, result);
    } catch (err) {
      ack(b, requestId, { ok: false, error: err.message });
    }
  }

  /* ------------------------------------------------ after a pinned lookup */

  /**
   * Bring Notion forward once a project has landed in it — the "switch" in
   * the handoff. macOS does not paint a covered window, so without this the
   * project exists but nobody can see it. Only for windows a handoff chose.
   */
  function reveal(targetId) {
    if (!handed.has(targetId)) return false;
    execFile('open', ['-a', NOTION_APP], () => {});
    return true;
  }

  /**
   * Called for every pinned window the server resolves. A handoff window
   * whose bridge dropped (Modable restarted, socket closed) gets it back, so
   * its project can still jump to Discord.
   */
  function noteTarget(target, owner) {
    if (target && target.type === 'page' && (handed.has(target.id) || owner === NOTION_APP)) attachBridge(target);
  }

  return { notionTarget, openSource, reveal, noteTarget };
}

module.exports = { createHandoff, pickNotionDocument };
