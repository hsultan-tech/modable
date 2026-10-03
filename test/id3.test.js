/**
 * Tagging the copy.
 *
 * An untagged MP3 lands in Spotify's Local Files as a filename among hundreds
 * of other files from ~/Music, iTunes and Downloads — which is exactly what
 * happened: the import worked and was impossible to find. Tags are what give
 * Spotify something to group and display.
 *
 * Only ever written to Modable's copy. The original is the user's file.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { readTags, writeTags, titleFromFilename, IMPORT_ALBUM } = require('../lib/id3.js');

/** A byte or two of "audio" is enough: the tag is what is under test. */
const AUDIO = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x11, 0x22, 0x33, 0x44]);

describe('writing tags', () => {
  it('puts a readable title, artist and album on an untagged file', () => {
    const out = writeTags(AUDIO, { title: 'New Bestie', artist: 'Drake', album: IMPORT_ALBUM });
    expect(readTags(out)).toEqual({ title: 'New Bestie', artist: 'Drake', album: IMPORT_ALBUM });
  });

  it('leaves the audio bytes untouched after the tag', () => {
    const out = writeTags(AUDIO, { title: 'x', artist: 'y', album: 'z' });
    expect(out.subarray(out.length - AUDIO.length)).toEqual(AUDIO);
  });

  it('replaces an existing tag rather than stacking a second one', () => {
    const once = writeTags(AUDIO, { title: 'First', artist: 'a', album: 'b' });
    const twice = writeTags(once, { title: 'Second', artist: 'c', album: 'd' });

    expect(readTags(twice).title).toBe('Second');
    // Two stacked tags would leave the file longer than one tag plus the audio.
    expect(twice.length).toBe(once.length - 'First'.length + 'Second'.length);
  });

  it('survives characters outside latin-1, which filenames are full of', () => {
    const out = writeTags(AUDIO, { title: 'Déjà vu — ★', artist: 'Ø', album: IMPORT_ALBUM });
    expect(readTags(out).title).toBe('Déjà vu — ★');
  });

  it('reads nothing from a file that has no tag', () => {
    expect(readTags(AUDIO)).toEqual({ title: '', artist: '', album: '' });
  });
});

describe('making a title out of a filename', () => {
  it('drops the extension', () => {
    expect(titleFromFilename('new-bestie.mp3')).toBe('New Bestie');
  });

  it('turns separators into spaces and capitalises', () => {
    expect(titleFromFilename('lil_durk_pelle-coat.mp3')).toBe('Lil Durk Pelle Coat');
  });

  it('strips the bitrate junk download sites leave behind', () => {
    expect(titleFromFilename('New Bestie - Drake (128k).mp3')).toBe('New Bestie - Drake');
  });

  it('falls back to something rather than an empty title', () => {
    expect(titleFromFilename('.mp3').length).toBeGreaterThan(0);
  });
});

describe('frames Modable does not manage', () => {
  it('keeps them — cover art is most of what a tagged file carries', () => {
    // Stripping the whole tag made an imported file SMALLER than the original
    // and silently threw away the artwork the user already had.
    const art = Buffer.concat([
      Buffer.from('APIC', 'latin1'),
      (() => { const h = Buffer.alloc(6); h.writeUInt32BE(12, 0); return h; })(),
      Buffer.from('imagedataxyz', 'latin1'),
    ]);
    const tagged = Buffer.concat([
      Buffer.from('ID3', 'latin1'),
      Buffer.from([0x03, 0x00, 0x00]),
      Buffer.from([0x00, 0x00, 0x00, art.length]),
      art,
      AUDIO,
    ]);

    const out = writeTags(tagged, { title: 'T', artist: 'A', album: IMPORT_ALBUM });

    expect(out.includes(Buffer.from('APIC', 'latin1'))).toBe(true);
    expect(out.includes(Buffer.from('imagedataxyz', 'latin1'))).toBe(true);
    expect(readTags(out)).toEqual({ title: 'T', artist: 'A', album: IMPORT_ALBUM });
  });

  it('does not leave a second copy of a frame it replaced', () => {
    const once = writeTags(AUDIO, { title: 'First', artist: 'a', album: 'b' });
    const twice = writeTags(once, { title: 'Second', artist: 'a', album: 'b' });
    const count = twice.toString('latin1').split('TIT2').length - 1;
    expect(count).toBe(1);
  });
});
