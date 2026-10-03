/**
 * Which debugging session belongs to which application.
 *
 * Modable used to assume one debug port (9222) for everything, so whichever
 * app held it was "the" app: with Discord on 9222 and Notion on 9223, asking
 * Notion for Spatial Mode probed Discord and was refused. Each app now has its
 * own session, and every route resolves through here:
 *
 *   app (.app bundle path) → port → page targets → targetId
 *
 * There is no stored registry to go stale. The OS already knows which process
 * listens on which port, so the session table is read from lsof (cached for a
 * moment) every time it is needed: an app that quits drops out of the table on
 * its own, and nothing about the others changes. A pinned targetId is looked
 * up across every session, so a layer always lands in the window it was read
 * from, whichever app owns it.
 *
 * Ports are taken from PORT_MIN..PORT_MAX. An app already running under a
 * session is reused; one running without a debugger is restarted onto a free
 * port.
 */
const { execSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT_MIN = 9222;
const PORT_MAX = 9241;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Bundle path of a running process, from its executable path. */
function bundleOf(exe) {
  const m = String(exe || '').match(/^(.*?\.app)\//);
  return m ? m[1] : null;
}

/** "/Applications/Notion.app" → "Notion" */
function appName(appPath) {
  return path.basename(String(appPath || ''), '.app');
}

/**
 * lsof's LISTEN table → port → pid, for ports in the session range.
 * Split out so it can be tested without a process table.
 */
function parseListeners(text) {
  const pidByPort = new Map();
  for (const line of String(text || '').split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    const name = cols.find(c => /:\d+$/.test(c));
    const port = name ? Number(name.split(':').pop()) : NaN;
    if (port >= PORT_MIN && port <= PORT_MAX && !pidByPort.has(port) && /^\d+$/.test(cols[1] || '')) {
      pidByPort.set(port, cols[1]);
    }
  }
  return pidByPort;
}

let cache = null; // { at, byPort: Map<port, appPath|null> }

/**
 * Every listener in the session range, and the .app bundle behind it.
 * One lsof and one ps, cached briefly so a probe → inject → verify run does
 * not re-read the process table for each call.
 */
function scan({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 800) return cache.byPort;
  let out = '';
  try {
    out = execSync('lsof -nP -iTCP -sTCP:LISTEN', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch { out = ''; }
  const pidByPort = parseListeners(out);
  const pids = [...new Set(pidByPort.values())];
  const exeByPid = new Map();
  if (pids.length) {
    try {
      const ps = execSync(`ps -o pid=,comm= -p ${pids.join(',')}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      for (const l of ps.split('\n')) {
        const m = l.trim().match(/^(\d+)\s+(.*)$/);
        if (m) exeByPid.set(m[1], m[2]);
      }
    } catch {}
  }
  const byPort = new Map();
  for (const [port, pid] of pidByPort) byPort.set(port, bundleOf(exeByPid.get(pid)));
  cache = { at: Date.now(), byPort };
  return byPort;
}

function invalidate() { cache = null; }

/** The port an app's session listens on, or null when it has none. */
function portFor(appPath) {
  if (!appPath) return null;
  for (const [port, owner] of scan()) if (owner === appPath) return port;
  return null;
}

/** The .app bundle listening on a port, or null. */
function ownerOf(port) {
  return scan().get(Number(port)) || null;
}

function freePort() {
  const used = scan({ fresh: true });
  for (let p = PORT_MIN; p <= PORT_MAX; p++) if (!used.has(p)) return p;
  return null;
}

/** CDP's target list on a port. */
function pages(port, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/json`, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * A target by id, whichever session it belongs to. Ids are unique per
 * browser, so the first match is the only match.
 */
async function findTarget(targetId) {
  if (!targetId) return null;
  for (const port of scan().keys()) {
    try {
      const list = await pages(port, 1500);
      const t = list.find(p => p.id === targetId && p.webSocketDebuggerUrl);
      if (t) return { target: t, port, owner: ownerOf(port) };
    } catch {}
  }
  return null;
}

function running(appPath) {
  try {
    execSync(`pgrep -x "${appName(appPath)}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The app's session, starting one if needed.
 *
 * Already under a session: reused as is. Running without a debugger: quit and
 * relaunched onto a free port (a debugger can only be attached at launch).
 * Not running: launched onto a free port. Other apps' sessions are never
 * touched.
 */
async function ensure(appPath, { timeout = 15000 } = {}) {
  const existing = portFor(appPath);
  if (existing) return { port: existing, reused: true };

  const name = appName(appPath);
  if (running(appPath)) {
    try { execSync(`pkill -x "${name}"`, { stdio: 'pipe' }); } catch {}
    for (let i = 0; i < 24 && running(appPath); i++) await sleep(250);
    await sleep(600);
  }
  const port = freePort();
  if (!port) throw new Error(`No free debugging port between ${PORT_MIN} and ${PORT_MAX}.`);

  // Launched from a process Electron forked with ELECTRON_RUN_AS_NODE=1;
  // passed on, it makes the target boot as bare Node and exit at once.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(appPath, 'Contents/MacOS', name), [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
  console.log(`[Modable] Launching ${name} on debug port ${port}`);

  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await sleep(500);
    invalidate();
    if (ownerOf(port) === appPath) {
      try {
        const list = await pages(port, 1500);
        if (list.some(p => p.type === 'page')) return { port, reused: false };
      } catch {}
    }
  }
  return { port, reused: false, pending: true };
}

/** Every live session, for logs and the status route. */
function sessions() {
  return [...scan()].map(([port, app]) => ({ port, app }));
}

module.exports = {
  PORT_MIN, PORT_MAX, appName, parseListeners, scan, invalidate, portFor, ownerOf, freePort, pages, findTarget, ensure, sessions,
};
