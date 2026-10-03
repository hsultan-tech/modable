/**
 * The local-file import adapter.
 *
 * Journey: a user hands Modable an MP3 and says "add this to Spotify". The file
 * must end up somewhere Spotify already scans, the original must be untouched,
 * and everything Modable wrote must come back off without taking anything of
 * theirs with it.
 *
 * These tests run against a temporary HOME. Nothing here touches the real
 * ~/Music or the real Spicetify install — the live check against the installed
 * Spotify is a separate, manual step, because a unit test that patches a music
 * player is not a unit test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  IMPORT_DIR_NAME,
  importsDir,
  ensureImportsDir,
  safeDestination,
  copyTrack,
  buildImportsExtension,
  describeSources,
  ownedFiles,
} = require('../lib/localImport.js');

let home;
let sourceDir;

/** Icon names Spicetify ships, read out of the installed wrapper. Anything else
 *  renders as literal text. */
const SPICETIFY_ICONS = [
  'album', 'artist', 'block', 'check', 'copy', 'download', 'edit', 'heart',
  'library', 'list-view', 'lyrics', 'menu', 'play', 'playlist',
  'playlist-folder', 'plus-alt', 'search', 'skip-back', 'skip-forward',
  'spotify', 'user',
];

/** A file with MP3-ish bytes. Enough to prove a copy is byte-identical. */
function writeFakeMp3(dir, name = 'track.mp3') {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x01, 0x02, 0x03]));
  return file;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'modable-home-'));
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modable-src-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(sourceDir, { recursive: true, force: true });
});

describe('where imports live', () => {
  it("is a folder inside the user's Music library", () => {
    // Not an arbitrary path: Spotify's own "My Music" source already scans
    // ~/Music, which is what makes this work without touching their settings.
    expect(importsDir(home)).toBe(path.join(home, 'Music', IMPORT_DIR_NAME));
  });

  it('creates the folder when it is missing, and says it created it', () => {
    const first = ensureImportsDir(home);
    expect(first.created).toBe(true);
    expect(fs.existsSync(first.dir)).toBe(true);
  });

  it('is happy when the folder already exists', () => {
    ensureImportsDir(home);
    const second = ensureImportsDir(home);
    expect(second.created).toBe(false);
    expect(second.dir).toBe(importsDir(home));
  });
});

describe('copying the track', () => {
  it('copies the audio into the imports folder unchanged', () => {
    // Not byte-for-byte any more: the copy carries an ID3 tag the original does
    // not, which is what makes it findable in Spotify. The audio behind the tag
    // is the part that must survive untouched.
    const src = writeFakeMp3(sourceDir, 'song.mp3');
    const audio = fs.readFileSync(src);
    const result = copyTrack(src, home);
    const copy = fs.readFileSync(result.destination);

    expect(result.success).toBe(true);
    expect(copy.subarray(copy.length - audio.length)).toEqual(audio);
    expect(path.dirname(result.destination)).toBe(importsDir(home));
  });

  it('never modifies or removes the original', () => {
    const src = writeFakeMp3(sourceDir, 'song.mp3');
    const before = fs.readFileSync(src);
    const beforeStat = fs.statSync(src);

    copyTrack(src, home);

    expect(fs.existsSync(src)).toBe(true);
    expect(fs.readFileSync(src)).toEqual(before);
    expect(fs.statSync(src).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it('does not clobber a track of the same name that is already imported', () => {
    const a = writeFakeMp3(sourceDir, 'song.mp3');
    const other = path.join(sourceDir, 'nested');
    const b = writeFakeMp3(other, 'song.mp3');
    fs.writeFileSync(b, Buffer.from([0xff, 0xfb, 0x11, 0x22]));

    const first = copyTrack(a, home);
    const second = copyTrack(b, home);

    expect(second.destination).not.toBe(first.destination);
    const tail = (file, source) => {
      const buf = fs.readFileSync(file);
      return buf.subarray(buf.length - fs.readFileSync(source).length);
    };
    expect(tail(first.destination, a)).toEqual(fs.readFileSync(a));
    expect(tail(second.destination, b)).toEqual(fs.readFileSync(b));
  });

  it('refuses a file that is not there', () => {
    const result = copyTrack(path.join(sourceDir, 'nope.mp3'), home);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not find|does not exist/i);
  });

  it('refuses a file that is not audio Spotify can read', () => {
    const txt = path.join(sourceDir, 'notes.txt');
    fs.writeFileSync(txt, 'hello');
    const result = copyTrack(txt, home);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mp3|audio/i);
  });

  it('refuses a directory handed to it by mistake', () => {
    const result = copyTrack(sourceDir, home);
    expect(result.success).toBe(false);
  });
});

describe('destination naming', () => {
  it('keeps the original filename when nothing is in the way', () => {
    expect(path.basename(safeDestination(importsDir(home), 'Song.mp3'))).toBe('Song.mp3');
  });

  it('strips path separators out of a hostile name', () => {
    const dest = safeDestination(importsDir(home), '../../evil.mp3');
    expect(path.dirname(dest)).toBe(importsDir(home));
    expect(dest).not.toContain('..');
  });
});

describe('the Spicetify extension Modable owns', () => {
  const built = () => buildImportsExtension(path.join('/Users/x/Music', IMPORT_DIR_NAME));

  it('is named so revert can find it and nothing else', () => {
    expect(built()).toContain('modable');
  });

  it('routes to the local files page through the documented History API', () => {
    expect(built()).toContain('Spicetify.Platform.History.push');
    expect(built()).toContain('/collection/local-files');
  });

  it('waits for the namespaces it uses rather than assuming them', () => {
    // The readiness gate that decides whether a mod appears at all.
    expect(built()).toContain('"Topbar"');
    expect(built()).toContain('"Platform"');
  });

  it('uses an icon name Spicetify actually ships', () => {
    // A name that is not in Spicetify.SVGIcons renders as that literal word in
    // the top bar, which is how "folder" shipped as visible text the first time.
    const icon = built().match(/Topbar\.Button\([^,]+,\s*"([^"]*)"/)[1];
    expect(SPICETIFY_ICONS).toContain(icon);
  });

  it('does not attempt undocumented playlist insertion', () => {
    const out = built();
    expect(out).not.toMatch(/PlaylistAPI|addToPlaylist|createPlaylist/);
  });
});

describe('what Modable owns, for revert', () => {
  it('lists only modable-prefixed files and the imports folder', () => {
    const owned = ownedFiles(home);
    expect(owned.extension).toMatch(/modable-/);
    expect(owned.importsDir).toBe(importsDir(home));
  });
});

describe('reading the current configuration', () => {
  it('reports the imports folder and whether Spotify already scans it', () => {
    ensureImportsDir(home);
    const state = describeSources(home);
    expect(state.importsDir).toBe(importsDir(home));
    expect(state.insideMusicLibrary).toBe(true);
    expect(state.musicLibrary).toBe(path.join(home, 'Music'));
  });

  it('counts the tracks Modable has imported', () => {
    const src = writeFakeMp3(sourceDir, 'song.mp3');
    copyTrack(src, home);
    expect(describeSources(home).trackCount).toBe(1);
  });
});

describe('revert — what comes off, and what must never', () => {
  const { planRevert } = require('../lib/localImport.js');

  it('removes only the Modable-owned extension', () => {
    const plan = planRevert({
      home,
      installedExtensions: ['modable-imports.js', 'beautifulLyrics.js', 'shuffle+.js'],
    });
    expect(plan.removeExtensions).toEqual(['modable-imports.js']);
  });

  it('leaves the user\'s themes and extensions alone even when named similarly', () => {
    const plan = planRevert({
      home,
      installedExtensions: ['my-modable-notes.js', 'modable-imports.js'],
    });
    expect(plan.removeExtensions).not.toContain('my-modable-notes.js');
  });

  it('keeps the imported audio by default', () => {
    const plan = planRevert({ home, installedExtensions: ['modable-imports.js'] });
    expect(plan.removeImportedAudio).toBe(false);
    expect(plan.keptBecause).toMatch(/music|user/i);
  });

  it('never lists anything outside the imports folder for deletion', () => {
    const src = writeFakeMp3(sourceDir, 'song.mp3');
    copyTrack(src, home);
    const plan = planRevert({ home, installedExtensions: [], removeImportedAudio: true });
    for (const f of plan.removeFiles) {
      expect(f.startsWith(importsDir(home))).toBe(true);
    }
    // and the original the user gave us is not among them
    expect(plan.removeFiles).not.toContain(src);
  });
});

describe('tagging, so the import can be found among everything else', () => {
  const { readTags, IMPORT_ALBUM } = require('../lib/id3.js');

  it('tags the copy with the Modable Imports album', () => {
    const src = writeFakeMp3(sourceDir, 'new-bestie.mp3');
    const result = copyTrack(src, home);
    const tags = readTags(fs.readFileSync(result.destination));

    expect(tags.album).toBe(IMPORT_ALBUM);
    expect(tags.title).toBe('New Bestie');
  });

  it('leaves the original byte-identical — tags go on the copy only', () => {
    const src = writeFakeMp3(sourceDir, 'song.mp3');
    const before = fs.readFileSync(src);

    copyTrack(src, home);

    expect(fs.readFileSync(src)).toEqual(before);
    expect(readTags(fs.readFileSync(src)).album).toBe('');
  });

  it('keeps the audio intact behind the tag', () => {
    const src = writeFakeMp3(sourceDir, 'song.mp3');
    const audio = fs.readFileSync(src);
    const result = copyTrack(src, home);
    const copy = fs.readFileSync(result.destination);

    expect(copy.subarray(copy.length - audio.length)).toEqual(audio);
  });

  it('reports the title it gave the track, so the app can say it', () => {
    const src = writeFakeMp3(sourceDir, 'New Bestie - Drake (128k).mp3');
    expect(copyTrack(src, home).title).toBe('New Bestie - Drake');
  });
});
