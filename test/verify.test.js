import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verdict, revertScript } = require('../lib/verify.js');

const snap = names => ({ count: names.length, names });

describe('verdict — scoped to the layer that just ran', () => {
  it('passes when a mark the layer claimed is on the page', () => {
    const v = verdict(['clock'], snap([]), snap(['clock']));
    expect(v.verified).toBe(true);
    expect(v.matched).toEqual(['clock']);
  });

  it('THE BUG: a leftover mark from an earlier layer no longer passes a new one', () => {
    // 'clock' was written by a previous layer and survived. The new layer
    // claimed 'dark-mode' and added nothing. The old count-based check saw one
    // [data-modable] node and called this a success.
    const v = verdict(['dark-mode'], snap(['clock']), snap(['clock']));
    expect(v.verified).toBe(false);
    expect(v.matched).toEqual([]);
  });

  it('passes a refinement that reuses the same mark', () => {
    // v2 of the clock layer replaces v1. Same name, still a real success.
    expect(verdict(['clock'], snap(['clock']), snap(['clock'])).verified).toBe(true);
  });

  it('THE HALF-APPLIED LAYER: every claimed mark must be present, not just one', () => {
    // A theme layer claims the <style> that inverts the app and the toggle that
    // puts it back. The style landed, the toggle never did. Accepting this
    // leaves the application inverted with no way out, recorded as a success.
    const v = verdict(['night-mode', 'night-toggle'], snap([]), snap(['night-mode']));
    expect(v.verified).toBe(false);
    expect(v.matched).toEqual(['night-mode']);
  });

  it('passes when every claimed mark is present', () => {
    const v = verdict(['night-mode', 'night-toggle'], snap([]), snap(['night-mode', 'night-toggle']));
    expect(v.verified).toBe(true);
  });

  it('fails a layer that wiped the page and added nothing', () => {
    expect(verdict(['clock'], snap(['old']), snap([])).verified).toBe(false);
  });
});

describe('verdict — fallback when no marks could be read off the code', () => {
  it('accepts something genuinely new', () => {
    expect(verdict([], snap(['old']), snap(['fresh'])).verified).toBe(true);
  });

  it('still rejects an unchanged page', () => {
    expect(verdict([], snap(['old']), snap(['old'])).verified).toBe(false);
  });

  it('rejects an empty page', () => {
    expect(verdict(undefined, snap([]), snap([])).verified).toBe(false);
  });
});

describe('revertScript', () => {
  it('carries the layer marks it was given, so it removes only those', () => {
    // The selector is built inside the page from this list.
    const src = revertScript(['clock', 'theme-invert']);
    expect(src).toContain('["clock","theme-invert"]');
    expect(src).toContain("'[data-modable=\"' + m + '\"]'");
  });

  it('falls back to every Modable node when the layer named none', () => {
    const src = revertScript([]);
    expect(src).toContain('var wanted = [];');
    expect(src).toContain("'[data-modable]'");
  });

  it('strips modable- classes so a failed theme layer cannot strand the app', () => {
    expect(revertScript(['theme-invert'])).toContain("indexOf('modable-') === 0");
  });

  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(revertScript(['x']))).not.toThrow();
  });
});

describe('revertScript — teardown hooks', () => {
  const run = (marks, hooks) => {
    const calls = [];
    const window = { __modableTeardown: {} };
    for (const k of hooks) window.__modableTeardown[k] = () => calls.push(k);
    const document = {
      querySelectorAll: () => [],
      documentElement: { classList: [] },
    };
    // eslint-disable-next-line no-new-func
    const out = new Function('window', 'document', 'return ' + revertScript(marks))(window, document);
    return { calls, out, left: Object.keys(window.__modableTeardown) };
  };

  it('runs the hook whose key prefixes a reverted mark, and only that one', () => {
    const r = run(['notion-spatial-toggle', 'notion-spatial-style'], ['notion-spatial', 'clock']);
    expect(r.calls).toEqual(['notion-spatial']);
    expect(r.left).toEqual(['clock']);
    expect(r.out.tornDown).toEqual(['notion-spatial']);
  });

  it('runs every hook when no marks were claimed', () => {
    expect(run([], ['a', 'b']).calls).toEqual(['a', 'b']);
  });
});
