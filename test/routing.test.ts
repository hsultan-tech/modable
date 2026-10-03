import { describe, it, expect } from 'vitest';
import { channelFor, usesSpicetify, taskFor, extractAudioPath, importMessageForDrop } from '../src/agent/routing';
import { parseMod, extractCode } from '../src/agent/parseMod';

describe('channelFor — which path an app takes', () => {
  it('sends Spotify to Spicetify', () => {
    expect(channelFor('Spotify')).toBe('spicetify');
    expect(usesSpicetify('spotify')).toBe(true);
    expect(usesSpicetify(' Spotify ')).toBe(true);
  });

  it('leaves every Electron app on the CDP path', () => {
    // The regression that matters most: Slack must not be re-routed.
    for (const app of ['Slack', 'Discord', 'VS Code', 'Notion', 'Figma']) {
      expect(channelFor(app)).toBe('cdp');
    }
  });

  it('defaults to CDP when the app is unknown', () => {
    expect(channelFor(undefined)).toBe('cdp');
    expect(channelFor(null)).toBe('cdp');
    expect(channelFor('')).toBe('cdp');
  });
});

const CSS_REPLY = `KIND: css
NAME: Green Bar
DESCRIPTION: Paints the now playing bar green.

\`\`\`css
[data-testid="now-playing-bar"] { background: #1db954 !important; }
\`\`\``;

describe('parseMod — a stylesheet is read as a stylesheet', () => {
  it('accepts CSS that would never compile as JavaScript', () => {
    const mod = parseMod(CSS_REPLY, 'css');
    expect(mod).not.toBeNull();
    expect(mod!.kind).toBe('css');
    expect(mod!.name).toBe('Green Bar');
    expect(mod!.code).toContain('now-playing-bar');
    // Nothing to tag or verify by mark on this path — the file is the artefact.
    expect(mod!.marks).toEqual([]);
  });

  it('rejects a stylesheet whose fence never closed', () => {
    // Same bar as the JS path: a cut-off reply must not reach Spotify.
    const truncated = CSS_REPLY.replace(/```$/, '');
    expect(parseMod(truncated, 'css')).toBeNull();
  });

  it('still applies the JavaScript compile check on the CDP path', () => {
    const broken = 'NAME: X\n\n```javascript\n(function(){ var a = ;\n```';
    expect(parseMod(broken)).toBeNull();
  });

  it('marks a normal CDP layer as js', () => {
    const good = `NAME: Clock

\`\`\`javascript
(function(){ var e = document.createElement('div'); e.setAttribute('data-modable','clock'); })();
\`\`\``;
    const mod = parseMod(good);
    expect(mod!.kind).toBe('js');
    expect(mod!.marks).toEqual(['clock']);
  });
});

describe('extractCode — the live buffer follows the right fence', () => {
  it('reads a css fence while it is still open', () => {
    expect(extractCode('```css\n.a { color: red; }', 'css')).toContain('color: red');
  });

  it('is unchanged for javascript', () => {
    expect(extractCode('```javascript\nvar a = 1;', 'js')).toContain('var a = 1');
  });
});

describe('local-file tasks — "add this to Spotify"', () => {
  it('routes an mp3 handed to Spotify to the local-import adapter', () => {
    expect(taskFor('spotify', 'add this to spotify', '/Users/x/song.mp3')).toBe('spicetify-local-import')
  })

  it('routes a spoken import request with no attachment the same way', () => {
    expect(taskFor('spotify', 'import this mp3 into my library', null)).toBe('spicetify-local-import')
  })

  it('leaves ordinary Spotify mods on the normal Spicetify path', () => {
    expect(taskFor('spotify', 'make the now playing bar green', null)).toBe('spicetify')
  })

  it('does not hijack a Spotify request that merely says the word file', () => {
    expect(taskFor('spotify', 'hide the file name in the sidebar', null)).toBe('spicetify')
  })

  it('never sends an mp3 down the local-import path for a non-Spotify app', () => {
    // Slack has no local files concept; an mp3 there is not an import.
    expect(taskFor('slack', 'add this to slack', '/Users/x/song.mp3')).toBe('cdp')
  })
})

describe('finding the file in what the user typed', () => {
  it('reads a path dragged into the prompt box', () => {
    // Chromium inserts the file path as text when a file is dropped on an input.
    expect(extractAudioPath('add /Users/x/Downloads/song.mp3 to spotify'))
      .toBe('/Users/x/Downloads/song.mp3')
  })

  it('handles a path with spaces in quotes', () => {
    expect(extractAudioPath('import "/Users/x/My Music/a track.mp3"'))
      .toBe('/Users/x/My Music/a track.mp3')
  })

  it('handles a file:// url, which is what some drops produce', () => {
    expect(extractAudioPath('file:///Users/x/song.mp3')).toBe('/Users/x/song.mp3')
  })

  it('expands a leading ~', () => {
    expect(extractAudioPath('add ~/Downloads/song.mp3', '/Users/x'))
      .toBe('/Users/x/Downloads/song.mp3')
  })

  it('finds nothing when no file was named', () => {
    expect(extractAudioPath('add a drag and drop mp3 button to the top bar')).toBeNull()
  })
})

describe('the request that shipped a fake uploader', () => {
  it('treats "drag and drop my mp3 files" as an import, not a mod to write', () => {
    // A Spicetify extension cannot read a dropped file from disk, so generating
    // code for this always produces a button that lies about having uploaded.
    expect(taskFor('spotify', 'add a feature to drag and drop my mp3 files in the top bar', null))
      .toBe('spicetify-local-import')
  })
})

describe('a file dropped on the prompt', () => {
  it('turns a dropped audio file into an import request', () => {
    // Electron 27 puts the real filesystem path on the File object; that path
    // is the only thing that makes an import possible from the renderer.
    const message = importMessageForDrop({ name: 'song.mp3', path: '/Users/x/song.mp3' })
    expect(extractAudioPath(message)).toBe('/Users/x/song.mp3')
    expect(taskFor('spotify', message, '/Users/x/song.mp3')).toBe('spicetify-local-import')
  })

  it('quotes a path with spaces so it survives extraction', () => {
    const message = importMessageForDrop({ name: 'a track.mp3', path: '/Users/x/My Music/a track.mp3' })
    expect(extractAudioPath(message)).toBe('/Users/x/My Music/a track.mp3')
  })

  it('ignores a dropped file that is not audio Modable imports', () => {
    expect(importMessageForDrop({ name: 'notes.pdf', path: '/Users/x/notes.pdf' })).toBeNull()
  })

  it('ignores a drop with no filesystem path behind it', () => {
    // A drag from a browser has no path, and inventing one imports nothing.
    expect(importMessageForDrop({ name: 'song.mp3', path: '' })).toBeNull()
  })
})
