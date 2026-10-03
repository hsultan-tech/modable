/**
 * Getting a file the user owns into Spotify.
 *
 * The whole operation in one sentence: copy the MP3 into a folder Spotify is
 * already scanning, and give the user a way to get to it inside the client.
 *
 * WHY NOT ANYTHING CLEVERER
 *
 * Spotify's local files are managed by the native client through an internal
 * esperanto service (local_files_esperanto.proto.LocalFiles in the bundle), not
 * by a text key in the prefs file — there is no supported line Modable can write
 * to register a new folder, and the prefs file on a fresh install has no
 * local-files entry at all. The client does expose "sources" in Settings, but
 * adding one opens a native folder picker; there is no documented API behind it,
 * and a LocalFilesAPI reachable from an extension is not in Spicetify's docs.
 *
 * What IS supported, and what this uses: Spotify ships a default source called
 * My Music that scans the user's ~/Music library recursively. A folder created
 * inside ~/Music is discovered by machinery Spotify already runs, with Modable
 * writing nothing into Spotify's configuration at all. The cost is honest and
 * worth stating: if the user has turned the My Music source off in Settings,
 * the track will not appear, and Modable cannot turn it back on for them
 * without reaching into configuration it has no supported way to touch.
 *
 * The same reasoning rules out playlist insertion, which is why none is
 * attempted here. The MVP's promise is that the track is reachable through
 * Local Files, and that promise is one Modable can actually keep.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** The one folder Modable writes audio into. Named, not generated, because
 *  revert has to be able to find it without a record to read. */
const IMPORT_DIR_NAME = 'Modable Imports';

/** Every file Modable creates inside Spicetify carries this prefix, so revert
 *  can take ours off and leave the user's themes and extensions alone. */
/* The name the mod is applied under. lib/spicetify.js prefixes every file it
   writes with "modable-", so naming this "Modable Imports" produced
   modable-modable-imports.js and revert, looking for modable-imports.js, could
   not find its own file. The prefix belongs to one layer only. */
const MOD_NAME = 'Imports';
const EXTENSION_SLUG = 'imports';
const EXTENSION_FILE = `modable-${EXTENSION_SLUG}.js`;

/**
 * What Spotify will actually play.
 *
 * Deliberately narrower than what Spotify supports (it also reads m4a, and
 * historically mp4/m4p) because the MVP's promise is about MP3s, and accepting
 * a format then failing to index it silently is the failure mode this codebase
 * keeps having to fix.
 */
const AUDIO_EXTENSIONS = ['.mp3'];

/** The MP3 frame sync / ID3 header. Checked because an extension is a claim and
 *  the bytes are the fact — a .mp3 that is really a text file indexes as
 *  nothing, with no error anywhere. */
function looksLikeMp3(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(3);
    fs.readSync(fd, head, 0, 3, 0);
    if (head.toString('latin1') === 'ID3') return true;
    return head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function musicLibrary(home = os.homedir()) {
  return path.join(home, 'Music');
}

function importsDir(home = os.homedir()) {
  return path.join(musicLibrary(home), IMPORT_DIR_NAME);
}

/**
 * Make the folder if it is not there.
 *
 * Reports whether it created it, because "we made you a folder" and "we used
 * the one you already had" are different things to tell someone about their
 * own music library.
 */
function ensureImportsDir(home = os.homedir()) {
  const dir = importsDir(home);
  if (fs.existsSync(dir)) return { dir, created: false };
  fs.mkdirSync(dir, { recursive: true });
  return { dir, created: true };
}

/**
 * Where a track with this name should land.
 *
 * Two jobs. The filename is reduced to its basename first — a name is data from
 * outside, and "../../evil.mp3" must not be able to write outside the imports
 * folder. Then a collision gets a numbered suffix rather than an overwrite,
 * because two different songs can share a filename and losing one of them is
 * not a tradeoff anybody agreed to.
 */
function safeDestination(dir, filename) {
  const base = path.basename(String(filename || 'track.mp3')).replace(/^\.+/, '') || 'track.mp3';
  const ext = path.extname(base);
  const stem = path.basename(base, ext);

  let candidate = path.join(dir, base);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

/**
 * Copy the user's file into the imports folder.
 *
 * copyFileSync, never a move or a link: the original is theirs, it stays where
 * it is, byte for byte, with its own timestamps. Every failure returns a
 * message rather than throwing, because each one is something to show the user,
 * not a stack to unwind.
 */
function copyTrack(sourcePath, home = os.homedir()) {
  const src = String(sourcePath || '');
  if (!src) return { success: false, error: 'No file was given.' };

  let stat;
  try {
    stat = fs.statSync(src);
  } catch {
    return { success: false, error: `Could not find ${src}.` };
  }
  if (stat.isDirectory()) {
    return { success: false, error: `${path.basename(src)} is a folder, not an audio file.` };
  }
  if (!AUDIO_EXTENSIONS.includes(path.extname(src).toLowerCase())) {
    return { success: false, error: `Modable imports MP3 files; ${path.basename(src)} is not one.` };
  }
  if (!looksLikeMp3(src)) {
    return {
      success: false,
      error: `${path.basename(src)} is named .mp3 but does not contain MP3 audio, so Spotify would not index it.`,
    };
  }

  const { dir, created } = ensureImportsDir(home);
  const destination = safeDestination(dir, path.basename(src));

  try {
    fs.copyFileSync(src, destination);
  } catch (err) {
    return { success: false, error: `Could not copy into ${dir}: ${err.message}` };
  }

  /* Tag the copy, never the original. An untagged file arrives in Spotify's
     Local Files as a bare filename among everything else it scanned, which is
     how the first working import turned out to be impossible to find. Existing
     tags win where the file has them: the user's own metadata is better than
     anything derived from a filename. */
  const id3 = require('./id3.js');
  let title = '';
  try {
    const raw = fs.readFileSync(destination);
    const existing = id3.readTags(raw);
    title = existing.title || id3.titleFromFilename(path.basename(src));
    fs.writeFileSync(
      destination,
      id3.writeTags(raw, {
        title,
        artist: existing.artist || 'Unknown Artist',
        album: id3.IMPORT_ALBUM,
      })
    );
  } catch {
    /* A file that cannot be tagged is still a file Spotify can play. The import
       is not worth failing over metadata. */
    title = title || id3.titleFromFilename(path.basename(src));
  }

  /* The invariant is about the audio, not the file. The copy carries a tag the
     original may not, so comparing file sizes answers the wrong question — it
     is what made a correctly imported file look like a truncated one. */
  const copiedBytes = fs.statSync(destination).size;
  const sourceAudioBytes = stat.size - id3.audioOffset(fs.readFileSync(src));
  const copiedAudioBytes = copiedBytes - id3.audioOffset(fs.readFileSync(destination));
  if (copiedAudioBytes !== sourceAudioBytes) {
    /* A short copy indexes as a corrupt track rather than failing outright, so
       it is caught here instead of in the user's library. */
    try { fs.unlinkSync(destination); } catch { /* nothing to undo */ }
    return { success: false, error: 'The copy did not come out with the same audio as the original.' };
  }

  return {
    success: true,
    source: src,
    destination,
    title,
    album: require('./id3.js').IMPORT_ALBUM,
    bytes: copiedBytes,
    createdFolder: created,
    originalIntact: fs.existsSync(src),
  };
}

/**
 * The extension that makes the folder reachable from inside Spotify.
 *
 * It does one thing: a top bar button that navigates to the Local Files page,
 * through Spicetify.Platform.History.push, which is documented. It does not try
 * to build a playlist, write to the user's library, or reach into any API that
 * is not in the docs — the MVP's claim stops at "reachable", and a button that
 * lands on the page holding the track is the honest shape of that claim.
 *
 * The readiness gate is the same one lib/spicetify.js learned the hard way:
 * Spicetify.Platform exists long before Spicetify.Topbar does, and a mod that
 * mounts against the wrong signal throws into a swallowed catch and leaves the
 * user with nothing on screen.
 */
function importsExtensionBody() {
  return [
    'new Spicetify.Topbar.Button("Modable Imports", "playlist-folder", function () {',
    '  // The Local Files page is where Spotify puts anything it found in the',
    '  // My Music source, which is where the imports folder lives.',
    '  Spicetify.Platform.History.push("/collection/local-files");',
    '});',
  ].join('\n');
}

function buildImportsExtension(dir) {
  /* Wrapped by lib/spicetify.js rather than here. The readiness gate is the
     thing that decides whether a mod appears at all, and it is not worth having
     two copies of it that can drift apart — see requiredNamespaces there. */
  const spicetify = require('./spicetify.js');
  const header = `// Imports folder: ${dir}\n`;
  return header + spicetify.buildJsExtension(EXTENSION_SLUG, 'Modable Imports', importsExtensionBody());
}

/**
 * Everything Modable owns, for revert to work from.
 *
 * Listed rather than recorded: a record can drift out of step with the disk,
 * and revert deleting something it merely believes is Modable's is exactly the
 * failure that must never happen in someone's music library.
 */
function ownedFiles(home = os.homedir()) {
  return {
    extension: EXTENSION_FILE,
    extensionSlug: EXTENSION_SLUG,
    importsDir: importsDir(home),
  };
}

/**
 * What a revert would take off, worked out before anything is deleted.
 *
 * Separated from the deleting so it can be tested without a filesystem to
 * destroy, and so the caller can show the user the list first. Deleting inside
 * somebody's music library on a guess is the one failure in this feature that
 * cannot be walked back.
 *
 * Exact-match on the filename, never a prefix test: "my-modable-notes.js" is
 * the user's, not ours, and a startsWith('modable') sweep would take it.
 */
function planRevert({ home = os.homedir(), installedExtensions = [], removeImportedAudio = false } = {}) {
  const owned = ownedFiles(home);
  const removeExtensions = installedExtensions.filter(f => f === owned.extension);

  /* The copies live in the user's Music library and play like any other track
     they own. Removing Modable's hook into Spotify is not a reason to take
     their music away, so this is opt-in and never the default. */
  const removeFiles = removeImportedAudio ? importedTracks(home) : [];

  return {
    removeExtensions,
    removeImportedAudio,
    removeFiles,
    keptBecause: removeImportedAudio
      ? ''
      : 'The imported tracks are the user\'s own music and stay in their Music library.',
    /* Named for the report: revert touches Modable's config line and Modable's
       extension file, and nothing else in the Spicetify install. */
    configKeysTouched: ['extensions'],
    neverTouched: ['themes', 'custom_apps', 'the original file the user supplied'],
  };
}

/** The MP3s Modable has imported. */
function importedTracks(home = os.homedir()) {
  const dir = importsDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => path.join(dir, f));
}

/**
 * What the local-file setup looks like right now.
 *
 * insideMusicLibrary is the load-bearing fact: it is the reason this works
 * without writing to Spotify's configuration, so it is reported rather than
 * assumed, and it would go false the moment somebody moved the folder.
 */
function describeSources(home = os.homedir()) {
  const dir = importsDir(home);
  const library = musicLibrary(home);
  const tracks = importedTracks(home);
  return {
    importsDir: dir,
    musicLibrary: library,
    exists: fs.existsSync(dir),
    insideMusicLibrary: dir.startsWith(library + path.sep),
    trackCount: tracks.length,
    tracks,
    /* Not knowable from disk: Spotify keeps the on/off state of its own default
       sources in the native client, so this is the one thing Modable has to ask
       the user to confirm rather than read. */
    mechanism: 'Spotify\'s built-in "My Music" source, which scans ~/Music recursively',
  };
}

/**
 * The whole import, end to end.
 *
 * Order matters and is the same discipline applyMod uses: put the audio in
 * place first, then hook Spotify up to it. An extension that points at a folder
 * with nothing in it is a button that opens an empty page, which reads as the
 * feature being broken.
 *
 * Every step reports rather than throws, and the step name comes back with the
 * failure, because "we could not copy your file" and "Spicetify would not
 * apply" are different problems with different fixes and the user is the one
 * who has to act on them.
 */
async function runImport({ sourcePath, home = os.homedir() } = {}) {
  const spicetify = require('./spicetify.js');

  const state = await spicetify.detect();
  if (!state.installed) {
    return { success: false, stage: 'detect', error: state.reason };
  }

  const before = describeSources(home);
  const copied = copyTrack(sourcePath, home);
  if (!copied.success) return { success: false, stage: 'copy', error: copied.error };

  const applied = await spicetify.applyMod({
    name: MOD_NAME,
    description: 'Adds a top bar button that opens your Modable Imports in Local Files.',
    kind: 'js',
    code: importsExtensionBody(),
  });
  if (!applied.success) {
    /* The audio is already in their Music folder and is theirs to keep, so it
       is left alone — but say so, rather than leaving them to discover a file
       they were not told about. */
    return {
      success: false,
      stage: applied.stage || 'apply',
      error: applied.error,
      copied,
      note: `The track was copied to ${copied.destination} and was left there.`,
    };
  }

  return {
    success: true,
    stage: 'done',
    copied,
    extension: applied.file,
    sources: describeSources(home),
    createdFolder: copied.createdFolder || before.exists === false,
    restartRequired: true,
  };
}

/**
 * Take Modable's side of it back off.
 *
 * Delegates the extension removal to revertMods, which already knows how to
 * take a Modable file out of the Spicetify config without disturbing the
 * user's themes or extensions. The audio is only removed when explicitly asked
 * for, and even then only from the imports folder.
 */
async function runRevert({ home = os.homedir(), removeImportedAudio = false } = {}) {
  const spicetify = require('./spicetify.js');
  const state = await spicetify.detect();
  const installed = state.installed ? spicetify.listMods(state).map(m => m.file) : [];

  const plan = planRevert({ home, installedExtensions: installed, removeImportedAudio });

  const reverted = await spicetify.revertMods(EXTENSION_SLUG);

  const deleted = [];
  for (const file of plan.removeFiles) {
    /* Belt and braces over the plan's own check: nothing outside the imports
       folder is deletable from here, whatever the plan says. */
    if (!file.startsWith(importsDir(home) + path.sep)) continue;
    try {
      fs.unlinkSync(file);
      deleted.push(file);
    } catch { /* already gone is the outcome we wanted */ }
  }

  return {
    success: reverted.success !== false,
    removedExtensions: reverted.removed || plan.removeExtensions,
    deletedTracks: deleted,
    keptTracks: removeImportedAudio ? [] : importedTracks(home),
    keptBecause: plan.keptBecause,
    untouched: plan.neverTouched,
    error: reverted.error,
  };
}

module.exports = {
  IMPORT_DIR_NAME,
  MOD_NAME,
  EXTENSION_SLUG,
  EXTENSION_FILE,
  AUDIO_EXTENSIONS,
  musicLibrary,
  importsDir,
  ensureImportsDir,
  safeDestination,
  looksLikeMp3,
  copyTrack,
  importsExtensionBody,
  buildImportsExtension,
  importedTracks,
  describeSources,
  ownedFiles,
  planRevert,
  runImport,
  runRevert,
};
