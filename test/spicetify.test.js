import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const {
  slugify, buildCssExtension, buildJsExtension, listMods, PREFIX,
} = require('../lib/spicetify.js');

describe('naming — everything Modable writes must be identifiable as ours', () => {
  it('slugs a mod name into something safe for a filename', () => {
    expect(slugify('Green Now Playing Bar')).toBe('green-now-playing-bar');
    expect(slugify('  Weird///Name!!  ')).toBe('weird-name');
  });

  it('never produces an empty slug, which would collide across mods', () => {
    expect(slugify('!!!')).toBe('mod');
    expect(slugify('')).toBe('mod');
  });

  it('keeps the prefix that makes revert safe', () => {
    // revertMods only ever touches files starting with this. If the prefix
    // changed without the revert matcher changing too, revert would either miss
    // Modable's files or reach into the user's.
    expect(PREFIX).toBe('modable-');
  });
});

describe('buildCssExtension — CSS has to survive being embedded in JS', () => {
  it('escapes a stylesheet containing quotes and newlines', () => {
    const css = '.x::after { content: "he said \\"hi\\""; }\n.y { color: red; }';
    const out = buildCssExtension('demo', 'Demo', css);
    // The generated file must parse as JavaScript; a naively interpolated
    // stylesheet with a quote in it would terminate the string early.
    expect(() => new Function(out)).not.toThrow();
    expect(out).toContain(JSON.stringify(css));
  });

  it('tags the style tag so it can be found and replaced', () => {
    const out = buildCssExtension('demo', 'Demo', 'body{}');
    expect(out).toContain("'modable-style-demo'");
    expect(out).toContain("setAttribute('data-modable', 'demo')");
    // Replacing rather than stacking is what makes re-applying a mod safe.
    expect(out).toContain('old.remove()');
  });
});

describe('buildJsExtension — an extension loads before Spotify is ready', () => {
  const out = buildJsExtension('demo', 'Demo', 'Spicetify.showNotification("x");');

  it('produces valid JavaScript', () => {
    expect(() => new Function(out)).not.toThrow();
  });

  it('waits for the Spicetify globals rather than assuming them', () => {
    // Without this the extension works or fails depending on load order.
    expect(out).toContain('window.Spicetify');
    // Platform is the floor of the gate, carried in the NEEDED list rather than
    // written out as a literal check — see requiredNamespaces.
    expect(out).toContain('"Platform"');
    expect(out).toContain('setTimeout(start, 200)');
  });

  it('contains the generated body and cannot throw silently', () => {
    expect(out).toContain('Spicetify.showNotification("x");');
    expect(out).toContain("console.error('[modable:demo]'");
  });
});

describe('listMods — what Modable has applied, and nothing else', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spicetify-test-'));
  const configPath = path.join(root, 'config-xpui.ini');
  fs.mkdirSync(path.join(root, 'Extensions'));
  fs.mkdirSync(path.join(root, 'modable'));
  fs.writeFileSync(path.join(root, 'Extensions', 'modable-green.js'), '//');
  fs.writeFileSync(path.join(root, 'Extensions', 'modable-quiet.js'), '//');
  // The user's own extension, which must never show up as Modable's to remove.
  fs.writeFileSync(path.join(root, 'Extensions', 'fullAppDisplay.js'), '//');
  fs.writeFileSync(
    path.join(root, 'modable', 'green.json'),
    JSON.stringify({ slug: 'green', name: 'Green Bar', kind: 'css', description: 'd', appliedAt: 1 }),
  );

  const mods = listMods({ configPath, extensions: ['modable-green.js', 'fullAppDisplay.js'] });

  it("ignores the user's own extensions entirely", () => {
    expect(mods.map(m => m.file).sort()).toEqual(['modable-green.js', 'modable-quiet.js']);
  });

  it('reads the saved metadata back', () => {
    const green = mods.find(m => m.slug === 'green');
    expect(green.name).toBe('Green Bar');
    expect(green.kind).toBe('css');
  });

  it('distinguishes applied from merely present on disk', () => {
    // A file the config does not list is inert; reporting it as applied would
    // explain a mod that visibly is not working as if it were working.
    expect(mods.find(m => m.slug === 'green').enabled).toBe(true);
    expect(mods.find(m => m.slug === 'quiet').enabled).toBe(false);
  });

  it('falls back to the slug when metadata is missing', () => {
    expect(mods.find(m => m.slug === 'quiet').name).toBe('quiet');
  });
});

describe('dead APIs — a mod that mounts and then does nothing', () => {
  const { findDeadApis } = require('../lib/spicetify.js');

  it('rejects the calls this client does not honour', () => {
    expect(findDeadApis('var n = Spicetify.Player.data.track.name;')).toHaveLength(1);
    expect(findDeadApis('navigator.clipboard.writeText(x)')).toHaveLength(1);
    expect(findDeadApis('alert("hi")')).toHaveLength(1);
  });

  it('leaves the shapes the prompt teaches alone', () => {
    expect(
      findDeadApis(
        'var item = Spicetify.Player.data && Spicetify.Player.data.item;' +
          'Spicetify.Platform.ClipboardAPI.copy(item.name);'
      )
    ).toEqual([]);
  });
});

describe('readiness — the wait that decides whether a mod appears at all', () => {
  const { requiredNamespaces, buildJsExtension } = require('../lib/spicetify.js');

  it('waits for the namespace the code actually uses, not just Platform', () => {
    expect(requiredNamespaces('new Spicetify.Topbar.Button("x","",fn)')).toContain('Topbar');
    expect(requiredNamespaces('Spicetify.Keyboard.registerShortcut({},fn)')).toContain('Keyboard');
  });

  it('always includes Platform as the floor', () => {
    expect(requiredNamespaces('var x = 1;')).toEqual(['Platform']);
  });

  it('gates a Topbar mod on Topbar and tells the user when it gives up', () => {
    const out = buildJsExtension('demo', 'Demo', 'new Spicetify.Topbar.Button("x","",fn);');
    expect(out).toContain('"Topbar"');
    expect(out).toContain('showNotification');
  });
});
