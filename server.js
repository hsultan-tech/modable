const express = require('express');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { pickTarget, isVisiblePage } = require('./lib/pickTarget');
const { verdict, revertScript } = require('./lib/verify');
const spicetify = require('./lib/spicetify');
const localImport = require('./lib/localImport');
const { createHandoff } = require('./lib/handoff');
const sessions = require('./lib/sessions');

const app = express();
const PORT = 3456;
// Only the default for a caller that names no app; every app's own session
// is resolved through lib/sessions.js.
const DEBUG_PORT = sessions.PORT_MIN;

app.use(express.json());
// __dirname, not a bare 'dist': when Electron forks this file the working
// directory is wherever the app was launched from, not the project root, and a
// cwd-relative root silently serves nothing.
app.use(express.static(path.join(__dirname, 'dist')));

/** Applications modified by patching them on disk rather than over CDP. The
 *  frontend's own copy of this decision lives in src/agent/routing.ts. */
const SPICETIFY_APPS = ['Spotify'];

// Applications Modable knows how to look for
const KNOWN_APPS = [
  { name: 'Slack', path: '/Applications/Slack.app', icon: '💬' },
  { name: 'Discord', path: '/Applications/Discord.app', icon: '🎮' },
  { name: 'VS Code', path: '/Applications/Visual Studio Code.app', icon: '💻' },
  { name: 'Notion', path: '/Applications/Notion.app', icon: '📝' },
  { name: 'Figma', path: '/Applications/Figma.app', icon: '🎨' },
  { name: 'Spotify', path: '/Applications/Spotify.app', icon: '🎵' },
  { name: 'WhatsApp', path: '/Applications/WhatsApp.app', icon: '📱' },
  { name: 'Telegram', path: '/Applications/Telegram.app', icon: '✈️' },
  { name: 'Obsidian', path: '/Applications/Obsidian.app', icon: '🗃️' },
];

// Helper to extract app icon as base64
function extractAppIcon(appPath) {
  try {
    const iconPath = path.join(appPath, 'Contents/Resources');
    if (!fs.existsSync(iconPath)) return null;
    
    const icnsFiles = fs.readdirSync(iconPath).filter(f => f.endsWith('.icns'));
    if (icnsFiles.length === 0) return null;
    
    const icnsFile = path.join(iconPath, icnsFiles[0]);
    const tempPng = path.join('/tmp', `${path.basename(appPath, '.app')}-${Date.now()}.png`);
    
    // Convert .icns to PNG using sips (built-in macOS tool)
    execSync(`sips -s format png "${icnsFile}" --out "${tempPng}" -Z 128 2>/dev/null`, { stdio: 'pipe' });
    
    if (fs.existsSync(tempPng)) {
      const imageBuffer = fs.readFileSync(tempPng);
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
      
      // Clean up temp file
      try { fs.unlinkSync(tempPng); } catch {}
      
      return base64Image;
    }
  } catch (err) {
    console.error(`Failed to extract icon for ${path.basename(appPath)}:`, err.message);
  }
  return null;
}

/**
 * Applications on this machine, and how — if at all — each one can be modified.
 *
 * "Reachable" used to mean "is Electron", because attaching a debugger was the
 * only way in. Spotify broke that equivalence: it is not Electron and never
 * opens a debug port, yet it is fully modifiable through Spicetify. Deciding
 * reachability from isElectron alone left it permanently greyed out as
 * "closed" — the index said Modable could not touch the one application it had
 * just been taught to patch.
 *
 * So the server answers the real question per app — which channel modifies it,
 * and is that channel usable right now — and the UI reads that instead of
 * inferring it from the runtime the app happens to be built on.
 */
app.get('/api/apps', async (req, res) => {
  const apps = [];

  // One detect for the whole list: it shells out to the CLI, and the answer is
  // the same for every app in the loop.
  let spicetifyState = null;
  try {
    spicetifyState = await spicetify.detect();
  } catch {
    spicetifyState = null;
  }

  for (const appInfo of KNOWN_APPS) {
    if (fs.existsSync(appInfo.path)) {
      const electronFramework = path.join(appInfo.path, 'Contents/Frameworks/Electron Framework.framework');
      const isElectron = fs.existsSync(electronFramework);
      
      let version = 'Unknown';
      try {
        const plistPath = path.join(appInfo.path, 'Contents/Info.plist');
        if (fs.existsSync(plistPath)) {
          const content = fs.readFileSync(plistPath, 'utf-8');
          const match = content.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
          if (match) version = match[1];
        }
        if (version === 'Unknown') {
          // Spotify ships a BINARY plist, which the regex above can only ever
          // read as "Unknown" — it was showing that in the index next to every
          // other app's real version. plutil converts either format.
          version = execSync(
            `plutil -extract CFBundleShortVersionString raw -o - "${plistPath}" 2>/dev/null`,
            { stdio: 'pipe' },
          ).toString().trim() || 'Unknown';
        }
      } catch {}
      
      // Extract real icon
      const realIcon = extractAppIcon(appInfo.path);
      
      const channel = SPICETIFY_APPS.includes(appInfo.name) ? 'spicetify' : 'cdp';
      const reachable = channel === 'spicetify'
        ? !!(spicetifyState && spicetifyState.installed && spicetifyState.spotifyFound && !spicetifyState.appStoreBuild)
        : isElectron;

      // Why an app cannot be modified, in the terms that actually apply to it.
      // "No debugger port" is meaningless for Spotify, and "install Spicetify"
      // is meaningless for Slack.
      let blockedBecause = null;
      if (!reachable) {
        if (channel === 'spicetify') {
          blockedBecause = !spicetifyState || !spicetifyState.installed
            ? 'Spicetify is not installed on this machine'
            : spicetifyState.appStoreBuild
              ? 'this is the sandboxed App Store build, which cannot be patched'
              : 'Spicetify cannot find this Spotify install';
        } else {
          blockedBecause = 'it has no debugger port for Modable to attach to';
        }
      }

      apps.push({
        ...appInfo, version, isElectron, hasMods: false, modCount: 0, realIcon,
        channel, reachable, blockedBecause,
      });
    }
  }
  res.json({ success: true, apps });
});

// Launch app with debugger — or reuse the session it already has.
// Each app gets its own debugging session (lib/sessions.js); launching one
// never quits or displaces another.
app.post('/api/launch', async (req, res) => {
  const { appPath } = req.body || {};
  const name = sessions.appName(appPath);
  try {
    const s = await sessions.ensure(appPath);
    if (s.reused) {
      console.log(`[Modable] ${name} already has a session on ${s.port}`);
      return res.json({ success: true, port: s.port, message: `${name} already connected!` });
    }
    res.json({
      success: true,
      port: s.port,
      message: s.pending ? `${name} launched - connecting...` : `${name} launched with Modable!`,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Is the selected app's session up? Without ?app= this answers for the legacy
// default port, as it always did.
app.get('/api/debugger/status', async (req, res) => {
  const appPath = req.query.app ? String(req.query.app) : null;
  const port = appPath ? sessions.portFor(appPath) : DEBUG_PORT;
  if (!port) return res.json({ success: true, ready: false, pageCount: 0 });
  try {
    const pages = await sessions.pages(port);
    res.json({ success: true, ready: pages.length > 0, pageCount: pages.length, port });
  } catch {
    res.json({ success: true, ready: false, pageCount: 0 });
  }
});

// The page inside the target app we should be talking to. Electron apps expose
// several targets (devtools, background pages); we want the visible window.
//
// `pinned` is the id an earlier call in this same run already settled on; it
// is found in whichever app's session holds it. Unpinned, `appPath` names the
// app whose session to read — the selected app, never whoever holds some
// shared port. The selection itself lives in lib/pickTarget.js so it can be
// tested directly.
async function resolveTarget(pinned, appPath) {
  if (pinned) {
    const found = await sessions.findTarget(pinned);
    if (found) {
      handoff.noteTarget(found.target, found.owner);
      return { target: found.target, error: null, port: found.port };
    }
    return pickTarget([], pinned);
  }

  const port = appPath ? sessions.portFor(appPath) : DEBUG_PORT;
  if (!port) {
    return {
      target: null,
      error: `${sessions.appName(appPath)} is not running with Modable. Launch it from Modable, then send this again.`,
    };
  }
  const pages = await sessions.pages(port);

  // Unpinned, more than one candidate: ask each window what it is showing.
  // Notion's hidden /blank page and its tab bar both look like real windows in
  // /json. Short timeout — some of its targets never answer, and those are
  // exactly the ones that should not be chosen.
  const candidates = pages.filter(isVisiblePage);
  let viewports;
  if (candidates.length > 1) {
    viewports = {};
    await Promise.all(candidates.map(async p => {
      const out = await cdpEvaluate(
        p.webSocketDebuggerUrl,
        '({visible: document.visibilityState === "visible", focus: document.hasFocus(), w: innerWidth, h: innerHeight})',
        1500,
      );
      if (out.success && out.result) viewports[p.id] = out.result;
    }));
  }
  return { ...pickTarget(pages, null, viewports), port };
}

/**
 * Read the running surface.
 *
 * The model cannot write against an app it has never seen. Before generating a
 * layer we evaluate SURFACE_PROBE inside the live application and hand the
 * result to the model, so it anchors to selectors that actually exist rather
 * than guessing at one app's markup.
 */
app.post('/api/probe', async (req, res) => {
  try {
    // A repair re-reads the window it already committed to, so the rewrite
    // answers the same DOM the first attempt missed in.
    const { target, error, port } = await resolveTarget(req.body?.targetId, req.body?.app);
    if (!target) return res.json({ success: false, error });

    const out = await cdpEvaluate(target.webSocketDebuggerUrl, SURFACE_PROBE);
    if (!out.success) return res.json(out);

    const surface = out.result || {};
    const owner = sessions.ownerOf(port);
    console.log(`[Modable] Read ${target.title} [${target.id}] from ${owner || 'unknown app'} — ${(surface.anchors || []).length} anchors, dark=${surface.darkNow}`);
    // targetId is the pin: whatever is written next must go to this same window.
    // owner lets the caller refuse a reading taken from some other application.
    res.json({ success: true, surface, targetId: target.id, owner, page: { title: target.title, url: target.url } });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Cross-app handoff (Discord → Notion). See lib/handoff.js.
// ---------------------------------------------------------------------------

const handoff = createHandoff({ cdpEvaluate, sessions });

/**
 * Read from the source app without writing to it.
 *
 * Pinned to the window the run already probed. The script is Modable's own
 * extraction (src/agent/layers/discordProjectSource.js), never model output.
 */
app.post('/api/handoff/read', async (req, res) => {
  const { code, targetId } = req.body || {};
  if (!code || !targetId) return res.json({ success: false, error: 'Nothing to read.' });
  try {
    const { target, error } = await resolveTarget(targetId);
    if (!target) return res.json({ success: false, error });
    const out = await cdpEvaluate(target.webSocketDebuggerUrl, code, 45000);
    res.json(out);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/** Put Notion on the handoff port and name its visible document window. */
app.post('/api/handoff/notion', async (req, res) => {
  try {
    const out = await handoff.notionTarget({ launch: req.body?.launch !== false });
    if (out.success) console.log(`[Modable] Handoff target: Notion "${out.title}" [${out.targetId}] on ${out.port}`);
    res.json(out);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Inject a layer, then confirm it actually took hold.
app.post('/api/inject', async (req, res) => {
  const { code, targetId, marks: expected } = req.body;
  console.log('[Modable] Injecting code...');

  try {
    // targetId comes from the read that produced this layer. Demanding it means
    // a layer can only ever land in the window it was written against; if that
    // window has gone, this fails loudly instead of writing into another one.
    const { target, error } = await resolveTarget(targetId);
    if (!target) return res.json({ success: false, error });

    console.log(`[Modable] Injecting into: ${target.title} [${target.id}] (${target.url})`);

    // What was already on the page, so a mark left by an earlier layer can be
    // told apart from one this layer put there.
    const pre = await cdpEvaluate(target.webSocketDebuggerUrl, MARKS_PROBE);
    const before = (pre.success && pre.result) || { count: 0, names: [] };

    const run = await cdpEvaluate(target.webSocketDebuggerUrl, code);
    if (!run.success) return res.json({ ...run, before: before.names });

    const post = await cdpEvaluate(target.webSocketDebuggerUrl, MARKS_PROBE);
    const after = (post.success && post.result) || { count: 0, names: [] };

    const { verified, matched } = verdict(expected, before, after);
    if (!verified) {
      console.log(
        `[Modable] Layer left nothing of its own — claimed [${(expected || []).join(', ') || 'nothing readable'}], ` +
        `page has [${after.names.join(', ') || 'none'}]`,
      );
    }

    // A cross-app handoff ends in the other app: show it.
    if (verified && handoff.reveal(target.id)) console.log('[Modable] Handoff landed — brought Notion forward');

    res.json({
      success: true,
      verified,
      elements: after.count,
      marks: after.names,
      matched,
      before: before.names,
      result: run.result,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/**
 * Take a layer back off the application.
 *
 * Called when an injection failed or could not be verified, so a half-applied
 * layer is not left running in somebody's Slack. Narrow by design — see
 * revertScript for exactly what it does and does not undo.
 */
app.post('/api/revert', async (req, res) => {
  const { targetId, marks } = req.body || {};

  try {
    const { target, error } = await resolveTarget(targetId);
    // Nothing to clean if the window is already gone — that is a success, not
    // a failure worth reporting on top of whatever went wrong first.
    if (!target) return res.json({ success: true, reverted: false, note: error });

    const out = await cdpEvaluate(target.webSocketDebuggerUrl, revertScript(marks));
    if (!out.success) return res.json({ success: false, error: out.error });

    const r = out.result || { removed: 0, stripped: [], remaining: 0 };
    console.log(`[Modable] Reverted ${r.removed} node(s), stripped [${(r.stripped || []).join(', ')}], ${r.remaining} left`);
    res.json({ success: true, reverted: true, ...r });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Spotify
//
// Everything above this block talks to a running application over CDP. Spotify
// cannot be reached that way — it is not Electron and exposes no debugger — so
// its modifications are written to disk and applied with the Spicetify CLI
// instead. The routes below are that path, and they are entirely separate from
// /api/probe, /api/inject and /api/revert, which keep working exactly as they
// did for Slack and everything else.
// ---------------------------------------------------------------------------

/** Is there a usable Spicetify, and what does the user already have set up? */
app.get('/api/spicetify/status', async (req, res) => {
  try {
    const state = await spicetify.detect();
    if (!state.installed) return res.json({ success: true, ...state, mods: [] });
    res.json({ success: true, ...state, mods: spicetify.listMods(state) });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/** Write one Modable modification and apply it through the CLI. */
app.post('/api/spicetify/apply', async (req, res) => {
  const { name, description, kind, code } = req.body || {};
  console.log(`[Modable] Spicetify apply: ${kind} "${name}"`);
  try {
    const result = await spicetify.applyMod({ name, description, kind, code });
    if (!result.success) {
      // The CLI's own words, not a paraphrase — an apply fails for reasons only
      // it can describe, and a generic message here would hide all of them.
      console.error(`[Modable] Spicetify failed at ${result.stage}: ${result.error}`);
    } else {
      console.log(`[Modable] Applied ${result.file} (verified=${result.verified})`);
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message, stage: 'apply' });
  }
});

/** Remove Modable's modifications — one by slug, or all of ours. Never theirs. */
app.post('/api/spicetify/revert', async (req, res) => {
  const { slug } = req.body || {};
  try {
    const result = await spicetify.revertMods(slug);
    console.log(`[Modable] Spicetify revert removed [${(result.removed || []).join(', ') || 'nothing'}]`);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* ---- Local file import -------------------------------------------------- */
/* A different shape of Spotify work from /api/spicetify/apply: that one writes
   code, this one moves audio the user owns. See lib/localImport.js for why the
   folder lives in ~/Music rather than in Spotify's own configuration. */

/** What the import setup looks like right now, before anything is changed. */
app.get('/api/spicetify/import/status', async (req, res) => {
  try {
    res.json({ success: true, ...localImport.describeSources() });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/** Copy one MP3 into Modable Imports and hook Spotify up to the folder. */
app.post('/api/spicetify/import', async (req, res) => {
  const { sourcePath } = req.body || {};
  console.log(`[Modable] Local import requested: ${sourcePath}`);
  try {
    const result = await localImport.runImport({ sourcePath });
    if (!result.success) {
      console.error(`[Modable] Import failed at ${result.stage}: ${result.error}`);
    } else {
      console.log(`[Modable] Imported ${result.copied.destination}`);
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message, stage: 'import' });
  }
});

/** Take Modable's import hook back off. Audio stays unless explicitly asked. */
app.post('/api/spicetify/import/revert', async (req, res) => {
  const { removeImportedAudio = false } = req.body || {};
  try {
    const result = await localImport.runRevert({ removeImportedAudio });
    console.log(`[Modable] Import revert removed [${(result.removedExtensions || []).join(', ') || 'nothing'}], kept ${result.keptTracks.length} track(s)`);
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Helper functions
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Evaluate an expression inside the target application and return its value.
 *
 * Used for both halves of the job: writing a layer, and reading the surface
 * back afterwards. allowUnsafeEvalBlockedByCSP matters — apps like Slack ship a
 * strict CSP, and without it the evaluation is refused before it runs.
 */
function cdpEvaluate(wsUrl, expression, timeoutMs = 10000) {
  return new Promise(resolve => {
    // Replace localhost with 127.0.0.1 to avoid IPv6 issues
    const fixedWsUrl = wsUrl.replace('localhost', '127.0.0.1');
    const ws = new WebSocket(fixedWsUrl);
    let done = false;

    const finish = result => {
      if (!done) {
        done = true;
        try { ws.close(); } catch {}
        resolve(result);
      }
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
          allowUnsafeEvalBlockedByCSP: true,
        },
      }));
    });

    ws.on('message', data => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id !== 1) return;

        if (msg.error) {
          return finish({ success: false, error: msg.error.message });
        }
        const thrown = msg.result?.exceptionDetails;
        if (thrown) {
          return finish({
            success: false,
            error: thrown.exception?.description || thrown.text || 'Script error',
          });
        }
        finish({ success: true, result: msg.result?.result?.value });
      } catch {}
    });

    ws.on('error', err => finish({
      success: false,
      error: `Could not reach the application's debugger: ${err.message}`,
    }));
    setTimeout(() => finish({ success: false, error: `The application did not respond within ${timeoutMs / 1000}s` }), timeoutMs);
  });
}

/**
 * Runs inside the target application to describe its live surface.
 *
 * Written as a function and stringified so it stays readable here rather than
 * living as an escaped string literal. It must not close over anything in this
 * file.
 */
function surfaceProbe() {
  var clip = function (s, n) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
  };

  // Perceived lightness of a computed colour, or null when fully transparent.
  var lum = function (color) {
    var m = String(color || '').match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    if (m.length > 3 && parseFloat(m[3]) === 0) return null;
    return Math.round(0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]);
  };

  var vw = window.innerWidth;
  var vh = window.innerHeight;

  // The palette the app actually paints: walk up from the middle of the window
  // until something opaque is found, since <body> is often transparent.
  var bg = null;
  var fg = null;
  var starts = [
    document.elementFromPoint(Math.round(vw / 2), Math.round(vh / 2)),
    document.elementFromPoint(Math.round(vw / 2), 10),
    document.body,
  ];
  for (var s = 0; s < starts.length && bg === null; s++) {
    var node = starts[s];
    while (node && node.nodeType === 1) {
      var cs = getComputedStyle(node);
      if (!fg) fg = cs.color;
      if (lum(cs.backgroundColor) !== null) { bg = cs.backgroundColor; break; }
      node = node.parentElement;
    }
  }
  var bgLum = lum(bg);

  // Controls the app already draws, which a new control can sit beside and
  // borrow styling from. Top chrome first — that is where toolbars live.
  var seen = {};
  var collect = function (maxTop, limit, into) {
    var all = document.querySelectorAll('button,[role="button"],[role="tab"],[aria-label],[data-qa],a[href]');
    for (var i = 0; i < all.length && into.length < limit; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      if (r.top < 0 || r.top > maxTop) continue;
      if (r.left < 0 || r.left > vw) continue;

      var label =
        el.getAttribute('aria-label') ||
        el.getAttribute('data-qa') ||
        el.getAttribute('title') ||
        clip(el.textContent, 24);
      if (!label) continue;

      var key = clip(label, 40) + '@' + Math.round(r.top) + ',' + Math.round(r.left);
      if (seen[key]) continue;
      seen[key] = 1;

      into.push({
        label: clip(label, 40),
        tag: el.tagName.toLowerCase(),
        cls: clip(el.className, 100),
        parentCls: clip(el.parentElement ? el.parentElement.className : '', 80),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      });
    }
  };

  var anchors = [];
  collect(150, 22, anchors);
  // Some apps put their chrome down the side instead of across the top.
  if (anchors.length < 6) collect(vh, 18, anchors);

  // Containers worth inserting into when no sibling control is a good match.
  var landmarks = [];
  ['banner', 'toolbar', 'navigation', 'main', 'complementary'].forEach(function (role) {
    var el = document.querySelector('[role="' + role + '"]');
    if (!el) return;
    var r = el.getBoundingClientRect();
    landmarks.push({
      role: role,
      cls: clip(el.className, 80),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    });
  });

  var existing = [];
  document.querySelectorAll('[data-modable]').forEach(function (el) {
    existing.push(clip(el.getAttribute('data-modable') || el.tagName.toLowerCase(), 40));
  });

  return {
    title: clip(document.title, 80),
    url: clip(location.href, 140),
    viewport: { w: vw, h: vh },
    background: bg,
    foreground: fg,
    backgroundLuminance: bgLum,
    darkNow: bgLum === null ? null : bgLum < 128,
    fontFamily: clip(getComputedStyle(document.body).fontFamily, 90),
    inverted: document.documentElement.classList.contains('modable-inverted'),
    anchors: anchors,
    landmarks: landmarks,
    existingLayers: existing,
  };
}

const SURFACE_PROBE = `(${surfaceProbe.toString()})()`;

/** Every data-modable value currently on the page, for before/after comparison. */
const MARKS_PROBE = `(function(){
  var nodes = document.querySelectorAll('[data-modable]');
  var names = [];
  for (var i = 0; i < nodes.length; i++) {
    names.push(nodes[i].getAttribute('data-modable') || '?');
  }
  return { count: nodes.length, names: names };
})()`;

// ---------------------------------------------------------------------------
// The model
//
// The renderer used to call api.openai.com itself. That put the key in the page
// and made every request hostage to the browser: content blockers, extensions
// and CSP all reject the call before it leaves, and the SDK reports the lot as
// a bare "Connection error." with nothing to act on. The call belongs here,
// where it either works or fails for a reason we can name.
// ---------------------------------------------------------------------------

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function describeNetworkError(err) {
  const code = err.cause?.code || err.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'Cannot reach api.openai.com — this machine has no DNS or no internet connection.';
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
    return 'The connection to api.openai.com was refused or reset. A VPN, proxy or firewall may be blocking it.';
  }
  if (String(code).includes('CERT') || String(code).includes('TLS')) {
    return 'The TLS check for api.openai.com failed — a corporate proxy may be intercepting HTTPS.';
  }
  if (err.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') {
    return 'The request to api.openai.com timed out.';
  }
  return `Could not reach api.openai.com: ${err.message}`;
}

function describeApiError(status, detail) {
  if (status === 401) return 'OpenAI rejected this API key. Change it from the profile menu.';
  if (status === 403) return detail || 'This OpenAI account is not permitted to use that model.';
  if (status === 404) return detail || 'That model is not available on this OpenAI account.';
  if (status === 429) {
    return /quota|billing|credit/i.test(detail || '')
      ? 'This OpenAI account is out of credit.'
      : 'OpenAI is rate limiting this key — wait a moment and run it again.';
  }
  if (status >= 500) return 'OpenAI had a server error. Run it again.';
  return detail || `OpenAI returned ${status}.`;
}

app.post('/api/agent', async (req, res) => {
  const { apiKey, messages, model = 'gpt-4o', temperature = 0.4, maxTokens = 2600 } = req.body || {};

  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'No API key set. Add one from the profile menu.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: 'Nothing to send to the model.' });
  }

  let upstream;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
    });
  } catch (err) {
    const message = describeNetworkError(err);
    console.error('[Modable] Model unreachable:', err.message);
    return res.status(502).json({ success: false, error: message });
  }

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    let detail = '';
    try { detail = JSON.parse(body)?.error?.message || ''; } catch { detail = body.slice(0, 200); }
    console.error(`[Modable] Model refused the request (${upstream.status}): ${detail}`);
    return res.status(upstream.status).json({ success: false, error: describeApiError(upstream.status, detail) });
  }

  // Pass the stream straight through, so the buffer fills as the model writes.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (res.flushHeaders) res.flushHeaders();

  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch (err) {
    console.error('[Modable] Stream cut off:', err.message);
    res.write(`\ndata: ${JSON.stringify({ modableError: `The response was cut off: ${err.message}` })}\n\n`);
  }
  res.end();
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║                   MODABLE                      ║
║      AI-Powered Desktop App Modifier          ║
╠═══════════════════════════════════════════════╣
║  Open in your browser:                        ║
║  → http://localhost:${PORT}                       ║
╚═══════════════════════════════════════════════╝
  `);
  // When Electron forked us it is holding its window back until this arrives.
  // Standalone (`node server.js`) there is no channel and this is a no-op.
  if (process.send) process.send({ type: 'ready', port: PORT });
});

// Losing the port is the one failure the parent cannot diagnose from outside:
// an occupied 3456 looks identical to a healthy server it did not start. Say
// which it is, then leave, so the parent can show a real message.
server.on('error', err => {
  console.error(`[Modable] Backend could not listen on ${PORT}: ${err.message}`);
  if (process.send) process.send({ type: 'error', code: err.code, message: err.message });
  process.exit(1);
});

// A clean quit stops us from the other side, but a crash or a force-quit never
// gets that far. The IPC channel closing is the one signal that survives it, so
// treat it as the end: a survivor holding 3456 would be silently adopted by the
// next launch as if it were healthy.
if (process.send) {
  process.on('disconnect', () => {
    console.log('[Modable] Parent went away - backend exiting');
    process.exit(0);
  });
}

