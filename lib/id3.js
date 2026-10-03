/**
 * The smallest ID3 writer that makes an import findable.
 *
 * Why this exists at all: the first live import landed a file with no tags
 * whatsoever, which Spotify shows in Local Files as a bare filename sitting
 * among everything else it scanned out of ~/Music, iTunes and Downloads. The
 * import had worked and was impossible to find, which to the person looking at
 * it is the same as not working.
 *
 * Tags fix that without touching Spotify's configuration or its DOM: every
 * Modable import gets the same album, so the client groups them together and
 * the user has one place to look.
 *
 * Hand-rolled rather than a dependency because this writes exactly three text
 * frames of ID3v2.3 and nothing else, and because it only ever runs against
 * Modable's own copy of the file. The user's original is never opened for
 * writing anywhere in this codebase.
 */

/** The album every Modable import carries. The whole point is that it is the
 *  same string every time, so they collect in one place in the client. */
const IMPORT_ALBUM = 'Modable Imports';

const FRAMES = { title: 'TIT2', artist: 'TPE1', album: 'TALB' };

/**
 * ID3v2 sizes are "synchsafe": 7 bits per byte, so the size can never contain a
 * byte that looks like an MP3 frame sync and confuse a decoder into playing the
 * tag as audio.
 */
function synchsafe(size) {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
}

function readSynchsafe(buf, offset) {
  return (
    (buf[offset] << 21) | (buf[offset + 1] << 14) | (buf[offset + 2] << 7) | buf[offset + 3]
  );
}

/**
 * One text frame.
 *
 * Latin-1 when the text fits it, UTF-16 with a byte order mark when it does
 * not. v2.3 has no UTF-8 encoding byte, and song titles are full of characters
 * latin-1 cannot hold — an accent or a dash silently mangled in the user's
 * library is not an acceptable cost for a simpler branch.
 */
function textFrame(id, value) {
  const text = String(value == null ? '' : value);
  const isLatin1 = /^[\x20-\x7e\xa0-\xff]*$/.test(text);

  const body = isLatin1
    ? Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'latin1'), Buffer.from([0x00])])
    : Buffer.concat([
        Buffer.from([0x01]),
        Buffer.from([0xff, 0xfe]), // little-endian BOM
        Buffer.from(text, 'utf16le'),
        Buffer.from([0x00, 0x00]),
      ]);

  const header = Buffer.alloc(10);
  header.write(id, 0, 4, 'latin1');
  header.writeUInt32BE(body.length, 4); // frame sizes in v2.3 are plain integers
  return Buffer.concat([header, body]);
}

function decodeText(body) {
  if (!body.length) return '';
  const encoding = body[0];
  const payload = body.subarray(1);

  if (encoding === 0x00) {
    return payload.toString('latin1').replace(/\0+$/, '');
  }
  if (encoding === 0x01) {
    // Strip the BOM, then read whichever endianness it declared.
    if (payload[0] === 0xff && payload[1] === 0xfe) {
      return payload.subarray(2).toString('utf16le').replace(/\0+$/, '');
    }
    if (payload[0] === 0xfe && payload[1] === 0xff) {
      const swapped = Buffer.from(payload.subarray(2));
      swapped.swap16();
      return swapped.toString('utf16le').replace(/\0+$/, '');
    }
    return payload.toString('utf16le').replace(/\0+$/, '');
  }
  // 0x03 is UTF-8 in v2.4; harmless to accept when reading.
  return payload.toString('utf8').replace(/\0+$/, '');
}

/** Where the audio starts: past an existing ID3v2 tag, or at byte zero. */
function audioOffset(buf) {
  if (buf.length < 10) return 0;
  if (buf.toString('latin1', 0, 3) !== 'ID3') return 0;
  return 10 + readSynchsafe(buf, 6);
}

/**
 * Read back the three frames Modable writes.
 *
 * Only these three: this is here to verify what was written, not to become a
 * general metadata parser.
 */
function readTags(buf) {
  const out = { title: '', artist: '', album: '' };
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return out;

  const end = audioOffset(buf);
  let pos = 10;
  while (pos + 10 <= end) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32BE(pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || size <= 0 || pos + 10 + size > end) break;

    const body = buf.subarray(pos + 10, pos + 10 + size);
    for (const [key, frameId] of Object.entries(FRAMES)) {
      if (id === frameId) out[key] = decodeText(body);
    }
    pos += 10 + size;
  }
  return out;
}

/**
 * The frames already on the file that are not Modable's to rewrite.
 *
 * Artwork (APIC) is usually the bulk of a tag, and losing it turns a track the
 * user recognises at a glance into an anonymous grey square in their library.
 */
function keptFrames(buf) {
  const kept = [];
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return kept;

  const managed = new Set(Object.values(FRAMES));
  const end = audioOffset(buf);
  let pos = 10;
  while (pos + 10 <= end) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32BE(pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id) || size <= 0 || pos + 10 + size > end) break;
    if (!managed.has(id)) kept.push(Buffer.from(buf.subarray(pos, pos + 10 + size)));
    pos += 10 + size;
  }
  return kept;
}

/**
 * Return the file with a fresh tag on the front.
 *
 * Any existing tag is dropped rather than appended to: two stacked tags is a
 * file that reads differently depending on which player opened it, and the
 * whole point here is that Spotify and the user agree about what the track is.
 */
function writeTags(buf, { title, artist, album } = {}) {
  const audio = buf.subarray(audioOffset(buf));

  /* Everything in the existing tag that Modable does not manage is carried
     across untouched. Dropping the whole tag looked simpler and threw away the
     user's cover art — it also made the imported file SMALLER than the file it
     came from, which is how it was caught. */
  const frames = Buffer.concat([
    ...keptFrames(buf),
    textFrame(FRAMES.title, title),
    textFrame(FRAMES.artist, artist),
    textFrame(FRAMES.album, album),
  ]);

  const header = Buffer.concat([
    Buffer.from('ID3', 'latin1'),
    Buffer.from([0x03, 0x00]), // v2.3.0
    Buffer.from([0x00]), // no flags
    synchsafe(frames.length),
  ]);

  return Buffer.concat([header, frames, audio]);
}

/**
 * A title a person would recognise, out of a filename.
 *
 * Download sites leave their own marks on filenames — a trailing "(128k)", an
 * "(Audio)", separators where spaces belong. None of that is the name of the
 * song, and all of it ends up on screen in the user's library if it is left in.
 */
function titleFromFilename(filename) {
  let name = String(filename || '').replace(/\.[a-z0-9]+$/i, '');

  name = name
    .replace(/\((?:\d{2,4}\s*k(?:bps)?|audio|lyrics?|official[^)]*|hq|hd)\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  /* Hyphens are load-bearing in "Artist - Title" and are left alone there; a
     hyphen between words in a slug is not, and becomes a space. */
  if (!/\s-\s/.test(name)) name = name.replace(/-+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  name = name
    .split(' ')
    .map(word => (word && /^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ')
    .trim();

  return name || 'Untitled import';
}

module.exports = {
  IMPORT_ALBUM,
  readTags,
  writeTags,
  titleFromFilename,
  audioOffset,
};
