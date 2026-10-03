/**
 * The Spotify adapter.
 *
 * Spotify is not Electron. It ships a CEF-based client with no remote debugging
 * port we can attach to, so the CDP path every other application in Modable
 * uses — read the DOM, evaluate a layer into it — has nothing to connect to.
 * The layer would be written against a window that never answers.
 *
 * Spicetify is the way in. It patches Spotify's own bundle on disk, so a
 * modification is a file plus a line of config plus `spicetify apply`, not an
 * evaluation into a live page. That makes this adapter file-shaped where the
 * CDP path is socket-shaped, and it is why Spotify routes here instead.
 *
 * Two rules govern everything below.
 *
 * ONE: nothing Modable writes may touch what the user already has. Their theme,
 * their Marketplace install and their own extensions are none of our business.
 * Every file we create is named `modable-<slug>.js` and lives beside theirs; we
 * only ever append our own entries to the extensions list and only ever remove
 * entries carrying our prefix. We never write the user's theme folder at all,
 * which is also why CSS ships inside a generated extension rather than as a
 * user.css — user.css belongs to whatever theme is installed (here,
 * Marketplace), and writing it would silently clobber their look.
 *
 * TWO: a failed CLI call must say what failed. `spicetify apply` reports real
 * problems — no backup, Spotify mid-update, a patched bundle that no longer
 * matches — and swallowing that output leaves a user with a mod that silently
 * did nothing.
 */

const { execFile, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Everything Modable writes carries this prefix. Nothing else is ever ours. */
const PREFIX = 'modable-';

/** Where Spicetify keeps its config; the CLI is the authority, this is fallback. */
const DEFAULT_CONFIG = path.join(os.homedir(), '.config', 'spicetify', 'config-xpui.ini');

/**
 * Find the CLI.
 *
 * The installer appends ~/.spicetify to PATH in the user's shell profile, which
 * a GUI-launched Electron app never reads — so a spicetify that works fine in
 * Terminal is invisible to us unless we look in the install location directly.
 */
function resolveCli() {
  const candidates = [
    path.join(os.homedir(), '.spicetify', 'spicetify'),
    '/opt/homebrew/bin/spicetify',
    '/usr/local/bin/spicetify',
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {}
  }
  return null;
}

/** Spicetify colours its output; stored or shown verbatim that is unreadable. */
function clean(s) {
  return String(s || '')
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Run the CLI and keep everything it said.
 *
 * Resolves rather than rejects on a non-zero exit: the caller wants the output
 * either way, and an apply that fails is a message to show, not an exception to
 * unwind. `spicetify apply` rewrites the whole bundle, hence the generous
 * timeout — on this machine a cold apply patches 250 files.
 */
function run(cli, args, timeout = 180000) {
  return new Promise(resolve => {
    execFile(cli, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const combined = [clean(stdout), clean(stderr)].filter(Boolean).join('\n');
      const command = `spicetify ${args.join(' ')}`;
      if (err) {
        resolve({ ok: false, command, output: combined, error: combined || err.message });
        return;
      }
      resolve({ ok: true, command, output: combined, error: null });
    });
  });
}

/** Parse the flat ini Spicetify writes. Good enough: it has no nested values. */
function readConfig(configPath) {
  const cfg = {};
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([a-z_]+)\s*=\s*(.*)$/);
      if (m) cfg[m[1]] = m[2].trim();
    }
  } catch {}
  return cfg;
}

function splitList(value) {
  return String(value || '').split('|').map(s => s.trim()).filter(Boolean);
}

/** Turn a mod name into a filename-safe slug. */
function slugify(name) {
  return (
    String(name || 'mod')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'mod'
  );
}

/**
 * Is this the sandboxed App Store build, which cannot be patched at all?
 *
 * The receipt sits at <Spotify.app>/Contents/_MASReceipt, but spotify_path is
 * not the bundle — Spicetify stores the Resources directory inside it. Walking
 * up to the .app is what makes this answer the right question; testing
 * spotify_path directly always said "no", which is the wrong answer to give
 * quietly when it means the apply is going to fail later for a reason we could
 * have named up front.
 */
function isAppStoreBuild(spotifyPath) {
  let dir = spotifyPath;
  for (let i = 0; i < 6 && dir && dir !== path.dirname(dir); i++) {
    if (dir.endsWith('.app')) return fs.existsSync(path.join(dir, 'Contents', '_MASReceipt'));
    dir = path.dirname(dir);
  }
  return false;
}

/**
 * The Spotify.app bundle, given whatever spotify_path points at.
 *
 * Spicetify stores the Resources directory inside the bundle, not the bundle
 * itself, so anything that needs the .app has to walk up to find it.
 */
function bundleOf(spotifyPath) {
  let dir = spotifyPath;
  for (let i = 0; i < 6 && dir && dir !== path.dirname(dir); i++) {
    if (dir.endsWith('.app')) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

/** The installed Spotify's version. Its Info.plist is binary, hence plutil. */
function spotifyVersion(spotifyPath) {
  const bundle = bundleOf(spotifyPath);
  if (!bundle) return null;
  try {
    return execFileSync(
      'plutil',
      ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(bundle, 'Contents', 'Info.plist')],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString().trim() || null;
  } catch {
    return null;
  }
}

function paths(configPath) {
  const root = path.dirname(configPath);
  return {
    root,
    extensions: path.join(root, 'Extensions'),
    // Sources live apart from the built extensions so a user browsing their own
    // Extensions folder sees one Modable file per mod, not two.
    sources: path.join(root, 'modable'),
  };
}

/**
 * What is installed and how it is currently configured.
 *
 * Also the guard the routing decision is made on: if this says installed is
 * false, Spotify has no working Spicetify path and the caller should say so
 * rather than write files that can never be applied.
 */
async function detect() {
  const cli = resolveCli();
  if (!cli) {
    return {
      installed: false,
      reason: 'Spicetify is not installed. Install it from spicetify.app, then reopen Modable.',
    };
  }

  const version = await run(cli, ['-v'], 15000);
  if (!version.ok) {
    return { installed: false, reason: `Spicetify is present but did not run: ${version.error}` };
  }

  const configOut = await run(cli, ['-c'], 15000);
  const configPath = configOut.ok && configOut.output ? configOut.output : DEFAULT_CONFIG;
  const cfg = readConfig(configPath);

  const spotifyPath = cfg.spotify_path || '/Applications/Spotify.app';
  const spotifyFound = fs.existsSync(spotifyPath);
  const extensions = splitList(cfg.extensions);

  /* Spotify updates itself, and an update replaces the very files Spicetify
     patched — leaving the backup describing a Spotify that no longer exists.
     Every apply then fails with "Spotify version and backup version are
     mismatched", which is only ever fixed by taking a fresh backup.
     Reading it here means the mismatch is known before anything is written,
     rather than being discovered by a failure the user has to interpret. The
     backup records a build string like 1.2.98.301.gfcaeba72, so compare on the
     dotted version prefix, not equality. */
  const installedVersion = spotifyFound ? spotifyVersion(spotifyPath) : null;
  const backupVersion = cfg.version || '';
  const backupMissing = !backupVersion;
  const backupStale = !backupMissing && !!installedVersion &&
    !backupVersion.startsWith(installedVersion);

  return {
    installed: true,
    version: version.output,
    cli,
    configPath,
    spotifyPath,
    spotifyFound,
    // The App Store build is sandboxed and cannot be patched. Worth naming,
    // because the failure otherwise arrives as an opaque apply error.
    appStoreBuild: spotifyFound && isAppStoreBuild(spotifyPath),
    spotifyVersion: installedVersion,
    backupVersion,
    backupMissing,
    backupStale,
    /* Spicetify cannot patch until this is dealt with, but it is repairable
       without the user doing anything, so it is not the same as "unusable". */
    needsBackup: backupMissing || backupStale,
    theme: cfg.current_theme || '',
    customApps: splitList(cfg.custom_apps),
    extensions,
    // Split so callers — and the user — can see at a glance that their own
    // extensions are untouched.
    userExtensions: extensions.filter(e => !e.startsWith(PREFIX)),
    modableExtensions: extensions.filter(e => e.startsWith(PREFIX)),
  };
}

/**
 * The JS file Modable writes for a visual mod.
 *
 * CSS cannot be registered with Spicetify on its own — the only stylesheet it
 * loads is the active theme's user.css, which is not ours to write. So the CSS
 * is carried into the client by a tiny extension that appends one <style> tag,
 * tagged with the slug so it can be found, replaced and removed by id alone.
 */
function buildCssExtension(slug, name, css) {
  return `// Modable — ${name}
// Generated file. Modable owns every file named ${PREFIX}*; editing this by hand
// means the next apply overwrites it. Remove it from Modable, not from disk.
(function () {
  var ID = 'modable-style-${slug}';
  function mount() {
    if (!document.head) return setTimeout(mount, 100);
    var old = document.getElementById(ID);
    if (old) old.remove();
    var style = document.createElement('style');
    style.id = ID;
    style.setAttribute('data-modable', '${slug}');
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
  }
  mount();
})();
`;
}

/**
 * Which Spicetify namespaces this code needs before it can run.
 *
 * Spicetify.Platform is NOT a readiness signal for the rest of it. Platform is
 * attached early; Topbar, Playbar, Keyboard, ContextMenu and PopupModal are
 * attached later, after the client's own chrome has mounted. Code that waits on
 * Platform and then calls `new Spicetify.Topbar.Button(...)` at the top level
 * loses that race nearly every time — the constructor is read off undefined, it
 * throws, the wrapper's catch swallows it, and the user restarts Spotify to
 * find nothing there. That is the single most common way a behavioural mod
 * "does nothing", and it is not the model's fault: the wrapper told it the
 * client was ready.
 *
 * So the gate is derived from the source. Whatever namespaces the code actually
 * touches are the ones that must exist before a line of it runs.
 */
const SPICETIFY_NAMESPACES = [
  'Topbar', 'Playbar', 'Keyboard', 'ContextMenu', 'PopupModal', 'Menu',
  'Player', 'Platform', 'CosmosAsync', 'LocalStorage', 'URI', 'SVGIcons',
];

function requiredNamespaces(code) {
  const src = String(code || '');
  const needed = SPICETIFY_NAMESPACES.filter(ns =>
    new RegExp('Spicetify\\s*\\.\\s*' + ns + '\\b').test(src)
  );
  /* Platform is the floor: the old wait used it alone and it is what tells us
     the Spicetify bundle itself finished attaching. */
  if (!needed.includes('Platform')) needed.push('Platform');
  return needed;
}

/**
 * The JS file Modable writes for a behavioural mod.
 *
 * Extensions are injected alongside Spotify's main script, which means they can
 * and do run before the Spicetify globals or the DOM exist. Every community
 * extension opens with this same wait; without it an extension works or fails
 * depending on load order, which is the hardest kind of bug to report. The
 * try/catch is the other half: an extension that throws takes nothing else
 * down, but a silent throw is indistinguishable from a mod that did nothing, so
 * it is logged with the slug in it.
 *
 * Two things the first version of this wrapper got wrong, both of which read to
 * the user as "Modable added nothing":
 *  - it waited on Spicetify.Platform only. See requiredNamespaces above.
 *  - it swallowed the throw into console.error, a place nobody modifying their
 *    music player is going to look. A mod that failed now says so on screen.
 */
function buildJsExtension(slug, name, code) {
  const needed = requiredNamespaces(code);
  return `// Modable — ${name}
// Generated file. Modable owns every file named ${PREFIX}*; editing this by hand
// means the next apply overwrites it. Remove it from Modable, not from disk.
(function () {
  var NEEDED = ${JSON.stringify(needed)};
  var waited = 0;

  function ready() {
    if (!window.Spicetify || !document.body) return false;
    for (var i = 0; i < NEEDED.length; i++) {
      if (!Spicetify[NEEDED[i]]) return false;
    }
    return true;
  }

  function report(message, err) {
    console.error('[modable:${slug}]', message, err || '');
    try {
      if (window.Spicetify && Spicetify.showNotification) {
        Spicetify.showNotification('Modable: "${name}" could not load. ' + message, true);
      }
    } catch (ignored) {}
  }

  function start() {
    if (!ready()) {
      waited += 200;
      // Spicetify attaches its chrome namespaces after the client mounts; 20s is
      // far past that on a cold start. Past it, the mod is not coming up, and
      // saying so beats waiting forever in silence.
      if (waited > 20000) {
        var missing = NEEDED.filter(function (n) { return !window.Spicetify || !Spicetify[n]; });
        return report('Spicetify.' + missing.join(', Spicetify.') + ' never became available.');
      }
      return setTimeout(start, 200);
    }
    try {
${String(code).split('\n').map(l => '      ' + l).join('\n')}
    } catch (e) {
      report(e && e.message ? e.message : String(e), e);
    }
  }

  start();
})();
`;
}

/**
 * Take a fresh backup and re-patch Spotify.
 *
 * This is the only cure for a backup that no longer matches the installed
 * Spotify, and Spotify updates itself on its own schedule — so a mod that
 * worked yesterday fails today through no action of the user's. The CLI's own
 * advice is "Please run spicetify backup apply", and making somebody open a
 * terminal to obey it would be the whole reason this adapter exists, undone.
 *
 * Safe to do unprompted: at this point Spotify is in its stock state (the
 * update overwrote every patched file), so the backup being taken is of a clean
 * client, and the user has just asked for a modification that cannot happen
 * without it. It is never silent — callers report that it ran.
 */
async function repairBackup(state) {
  const backedUp = await run(state.cli, ['backup', 'apply']);
  if (!backedUp.ok) {
    return {
      ok: false,
      error:
        'Spotify updated itself, and Spicetify could not take a fresh backup of the new ' +
        `version: ${backedUp.error}`,
      command: backedUp.command,
      output: backedUp.output,
    };
  }
  return { ok: true, output: backedUp.output };
}

/** Read back which Modable mods exist on disk, with their sources. */
function listMods(state) {
  const p = paths(state.configPath);
  const out = [];
  let files = [];
  try { files = fs.readdirSync(p.extensions); } catch { return out; }

  for (const file of files) {
    if (!file.startsWith(PREFIX) || !file.endsWith('.js')) continue;
    const slug = file.slice(PREFIX.length, -3);
    let meta = null;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(p.sources, `${slug}.json`), 'utf-8'));
    } catch {}
    out.push({
      slug,
      file,
      name: (meta && meta.name) || slug,
      kind: (meta && meta.kind) || 'js',
      description: (meta && meta.description) || '',
      appliedAt: (meta && meta.appliedAt) || null,
      // A file present but not in the config is installed-but-inactive, which
      // is a real state worth showing rather than rounding to "applied".
      enabled: state.extensions.includes(file),
    });
  }
  return out;
}

/**
 * Catch a dead API before it is written to disk.
 *
 * The failure this exists for: a behavioural mod mounts its control, the click
 * handler calls something that does not exist on this Spicetify, and the throw
 * is swallowed by the wrapper's try/catch. The button sits there looking
 * correct and does nothing, and every check Modable has — the file wrote, the
 * apply succeeded, the node appeared — reports success. The user is the one who
 * finds out, by clicking.
 *
 * So the check is on the source, before the write. Deliberately a short list of
 * things that are known-wrong rather than an allow-list of everything valid: a
 * false reject blocks a working mod, which is worse than the model occasionally
 * reaching past this. Each entry is a call the model writes from training that
 * this client does not honour.
 */
const DEAD_APIS = [
  {
    re: /Spicetify\s*\.\s*Player\s*\.\s*data\s*(?:\?\.|\.)\s*track\b/,
    why: 'Spicetify.Player.data.track does not exist — the current track is Spicetify.Player.data.item (guard it: data is null when nothing is playing).',
  },
  {
    re: /navigator\s*\.\s*clipboard/,
    why: 'navigator.clipboard is blocked in the Spotify client — copy with Spicetify.Platform.ClipboardAPI.copy(text).',
  },
  {
    re: /document\s*\.\s*execCommand\s*\(\s*['"`]copy/,
    why: 'document.execCommand("copy") does nothing in the Spotify client — use Spicetify.Platform.ClipboardAPI.copy(text).',
  },
  {
    re: /\b(?:window\s*\.\s*)?(?:alert|prompt|confirm)\s*\(/,
    why: 'alert/prompt/confirm do not render in the Spotify client — use Spicetify.showNotification(text) or Spicetify.PopupModal.',
  },
  {
    re: /\bSpicetify\s*\.\s*Player\s*\.\s*getTrackName\s*\(/,
    why: 'Spicetify.Player.getTrackName() was removed — read Spicetify.Player.data.item.name.',
  },
];

/**
 * Which of the dead APIs above this code uses. Empty means nothing known-wrong.
 */
function findDeadApis(code) {
  const src = String(code || '');
  return DEAD_APIS.filter(d => d.re.test(src)).map(d => d.why);
}

/**
 * Write a Modable mod and apply it.
 *
 * The order matters: files first, then config, then apply. An apply that runs
 * before the file exists patches Spotify to load something that is not there.
 */
async function applyMod({ name, description, kind, code }) {
  const state = await detect();
  if (!state.installed) return { success: false, error: state.reason, stage: 'detect' };
  if (!state.spotifyFound) {
    return { success: false, error: `No Spotify at ${state.spotifyPath}.`, stage: 'detect' };
  }
  if (state.appStoreBuild) {
    return {
      success: false,
      stage: 'detect',
      error:
        'This is the App Store build of Spotify, which is sandboxed and cannot be patched. ' +
        'Install the desktop build from spotify.com to modify it.',
    };
  }
  if (kind !== 'css' && kind !== 'js') {
    return { success: false, error: `Unknown modification kind "${kind}".`, stage: 'write' };
  }
  if (!String(code || '').trim()) {
    return { success: false, error: 'The modification was empty.', stage: 'write' };
  }

  /* Behavioural mods only: a stylesheet has no API surface to get wrong. */
  if (kind === 'js') {
    const dead = findDeadApis(code);
    if (dead.length) {
      return {
        success: false,
        stage: 'write',
        error:
          'This modification calls something the Spotify client does not have, so it ' +
          'would have mounted and then done nothing:\n' +
          dead.map(d => '\u2022 ' + d).join('\n'),
        deadApis: dead,
      };
    }
  }

  const slug = slugify(name);
  const file = `${PREFIX}${slug}.js`;
  const p = paths(state.configPath);

  /* Spotify has updated since Spicetify last patched it, so every apply below
     would fail on a mismatched backup. Repair first and say so, rather than
     letting the user read a CLI error about backups they did not know they
     had. */
  let repairedBackup = null;
  if (state.needsBackup) {
    const repaired = await repairBackup(state);
    if (!repaired.ok) {
      return { success: false, stage: 'backup', error: repaired.error, command: repaired.command, output: repaired.output };
    }
    repairedBackup = state.backupMissing
      ? 'Spicetify had no backup of Spotify, so Modable took one first.'
      : `Spotify updated itself to ${state.spotifyVersion}, so Modable re-took Spicetify's backup first.`;
  }

  try {
    fs.mkdirSync(p.extensions, { recursive: true });
    fs.mkdirSync(p.sources, { recursive: true });
    // The source is kept as written, separately from the wrapper built around
    // it, so a later revert or edit works from what the model actually produced.
    fs.writeFileSync(path.join(p.sources, `${slug}.${kind}`), code, 'utf-8');
    fs.writeFileSync(
      path.join(p.sources, `${slug}.json`),
      JSON.stringify({ slug, name, description: description || '', kind, appliedAt: Date.now() }, null, 2),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(p.extensions, file),
      kind === 'css' ? buildCssExtension(slug, name, code) : buildJsExtension(slug, name, code),
      'utf-8',
    );
  } catch (err) {
    return { success: false, stage: 'write', error: `Could not write the Spicetify files: ${err.message}` };
  }

  // `config extensions <file>` appends to the list, so the user's own entries
  // survive.
  if (!state.extensions.includes(file)) {
    const cfg = await run(state.cli, ['config', 'extensions', file], 30000);
    if (!cfg.ok) {
      return {
        success: false,
        stage: 'config',
        error: `Registering the extension failed: ${cfg.error}`,
        command: cfg.command,
        output: cfg.output,
      };
    }
  }

  const applied = await run(state.cli, ['apply']);
  if (!applied.ok) {
    return {
      success: false,
      stage: 'apply',
      error: `spicetify apply failed: ${applied.error}`,
      command: applied.command,
      output: applied.output,
    };
  }

  // Verification, such as it can be from outside the client: the file is on
  // disk, the config lists it, and apply reported success. We cannot read
  // Spotify's DOM back the way the CDP path does — there is no debugger to ask.
  const after = await detect();
  const registered = after.installed && after.extensions.includes(file);
  const onDisk = fs.existsSync(path.join(p.extensions, file));

  return {
    success: true,
    verified: registered && onDisk,
    slug,
    file,
    kind,
    stage: 'done',
    output: applied.output,
    repairedBackup,
    extensions: after.extensions,
    userExtensions: after.userExtensions,
    note: registered && onDisk
      ? 'Restart Spotify to load the modification.'
      : 'Applied, but the extension is not listed in the config — check Spicetify.',
  };
}

/**
 * Take Modable's modifications back off Spotify.
 *
 * Only ever removes entries carrying the Modable prefix. A slug removes one; no
 * slug removes all of ours and nothing else. The user's theme, custom apps and
 * own extensions are never named in these commands, so they cannot be caught by
 * them.
 */
async function revertMods(slug) {
  const state = await detect();
  if (!state.installed) return { success: false, error: state.reason, stage: 'detect' };

  const p = paths(state.configPath);
  const only = slug ? `${PREFIX}${slugify(slug)}.js` : null;

  // Files can exist while the config entry is gone, or the reverse. Clean both.
  const known = new Set(state.extensions.filter(e => e.startsWith(PREFIX)));
  try {
    for (const f of fs.readdirSync(p.extensions)) {
      if (f.startsWith(PREFIX) && f.endsWith('.js')) known.add(f);
    }
  } catch {}

  const targets = only ? [...known].filter(f => f === only) : [...known];
  const removed = [];
  const failures = [];

  for (const file of targets) {
    if (state.extensions.includes(file)) {
      // Trailing '-' is how the CLI removes one entry from a list value.
      const cfg = await run(state.cli, ['config', 'extensions', `${file}-`], 30000);
      if (!cfg.ok) {
        failures.push(`${file}: ${cfg.error}`);
        continue;
      }
    }
    const fileSlug = file.slice(PREFIX.length, -3);
    for (const doomed of [
      path.join(p.extensions, file),
      path.join(p.sources, `${fileSlug}.css`),
      path.join(p.sources, `${fileSlug}.js`),
      path.join(p.sources, `${fileSlug}.json`),
    ]) {
      try { fs.unlinkSync(doomed); } catch {}
    }
    removed.push(file);
  }

  if (!removed.length && !failures.length) {
    return { success: true, reverted: false, removed: [], note: 'Modable had nothing applied to Spotify.' };
  }

  /* A Spotify that has updated since it was patched is already back to stock —
     the update overwrote every patched file — so there is nothing left to
     un-patch and `apply` would only fail on the mismatched backup. Removing
     Modable's files is the whole of the revert in that case. Re-taking a
     backup here would be worse than useless: it would patch Spotify in order
     to finish removing something from it. */
  if (state.needsBackup) {
    const after = await detect();
    return {
      success: failures.length === 0,
      reverted: removed.length > 0,
      removed,
      error: failures.length ? `Some modifications could not be removed: ${failures.join('; ')}` : null,
      remainingModable: after.modableExtensions,
      userExtensions: after.userExtensions,
      theme: after.theme,
      customApps: after.customApps,
      note: 'Spotify had already updated itself back to a stock client, so removing the files was enough.',
    };
  }

  const applied = await run(state.cli, ['apply']);
  if (!applied.ok) {
    return {
      success: false,
      stage: 'apply',
      removed,
      error: `Files were removed but spicetify apply failed: ${applied.error}`,
      output: applied.output,
    };
  }

  const after = await detect();
  return {
    success: failures.length === 0,
    reverted: removed.length > 0,
    removed,
    error: failures.length ? `Some modifications could not be removed: ${failures.join('; ')}` : null,
    // Proof the promise at the top of this file was kept.
    remainingModable: after.modableExtensions,
    userExtensions: after.userExtensions,
    theme: after.theme,
    customApps: after.customApps,
    output: applied.output,
    note: 'Restart Spotify to drop the modification.',
  };
}

module.exports = {
  findDeadApis,
  requiredNamespaces,
  detect, applyMod, revertMods, listMods, repairBackup, spotifyVersion,
  slugify, buildCssExtension, buildJsExtension, PREFIX,
};
