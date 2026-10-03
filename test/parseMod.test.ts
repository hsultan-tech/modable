import { describe, it, expect } from 'vitest';
import { parseMod, extractCode, extractMarks, isSyntacticallyValid } from '../src/agent/parseMod';

const GOOD = `NAME: Floating Clock
DESCRIPTION: Puts the time in the corner.

\`\`\`javascript
(function(){
  document.querySelectorAll('[data-modable]').forEach(function(el){ el.remove(); });
  var d = document.createElement('div');
  d.setAttribute('data-modable', 'clock');
  document.body.appendChild(d);
})();
\`\`\``;

/** What a response cut off at max_tokens actually looks like: the fence opens
 *  and never closes, and the body stops mid-statement. */
const TRUNCATED = `NAME: Floating Clock
DESCRIPTION: Puts the time in the corner.

\`\`\`javascript
(function(){
  document.querySelectorAll('[data-modable]').forEach(function(el){ el.remove(); });
  var d = document.createElement('div');
  d.setAttribute('data-modable', 'cl`;

describe('parseMod — accepts a complete layer', () => {
  it('reads name, description and code', () => {
    const mod = parseMod(GOOD);
    expect(mod).not.toBeNull();
    expect(mod!.name).toBe('Floating Clock');
    expect(mod!.description).toBe('Puts the time in the corner.');
    expect(mod!.code).toContain('data-modable');
  });

  it('still accepts the older JSON shape', () => {
    const raw = '```json\n{"name":"X","description":"d","code":"(function(){})();"}\n```';
    expect(parseMod(raw)!.name).toBe('X');
  });
});

describe('parseMod — rejects what must never reach the application', () => {
  it('rejects a truncated response with an unterminated fence', () => {
    expect(parseMod(TRUNCATED)).toBeNull();
  });

  it('rejects code that will not compile', () => {
    const raw = 'NAME: Broken\n```javascript\n(function(){ var x = ; })();\n```';
    expect(parseMod(raw)).toBeNull();
  });

  it('rejects an unbalanced IIFE that only looks finished', () => {
    const raw = 'NAME: Broken\n```javascript\n(function(){ if (true) { var a = 1;\n```';
    expect(parseMod(raw)).toBeNull();
  });

  it('rejects a JSON layer whose code will not compile', () => {
    const raw = '```json\n{"name":"X","description":"d","code":"(function(){ var y = ; })();"}\n```';
    expect(parseMod(raw)).toBeNull();
  });

  it('rejects a reply with no code at all', () => {
    expect(parseMod('I could not do that.')).toBeNull();
  });
});

describe('extractCode — permissive on purpose, for the live buffer only', () => {
  it('returns partial code mid-stream so the buffer can fill', () => {
    // The very thing parseMod must reject is what the buffer needs to show.
    expect(extractCode(TRUNCATED)).toContain('createElement');
    expect(parseMod(TRUNCATED)).toBeNull();
  });
});

describe('isSyntacticallyValid', () => {
  it('compiles without executing the body', () => {
    let ran = false;
    (globalThis as Record<string, unknown>).__modableTestFlag = () => { ran = true; };
    expect(isSyntacticallyValid('__modableTestFlag();')).toBe(true);
    expect(ran).toBe(false);
  });
});

describe('extractMarks — what the layer claims it will leave behind', () => {
  it('reads every tagging form the models actually use', () => {
    const code = `(function(){
      document.querySelectorAll('[data-modable]').forEach(function(el){ el.remove(); });
      var s = document.createElement('style');
      s.setAttribute('data-modable', 'theme-invert');
      var b = document.createElement('button');
      b.setAttribute("data-modable", "dark-toggle");
      var w = document.createElement('div');
      w.innerHTML = '<span data-modable="badge">hi</span>';
      w.dataset.modable = 'wrapper';
    })();`;
    expect(extractMarks(code).sort()).toEqual(['badge', 'dark-toggle', 'theme-invert', 'wrapper']);
  });

  it('ignores the bare wipe selector, which names nothing', () => {
    expect(extractMarks(`document.querySelectorAll('[data-modable]').forEach(function(el){el.remove();});`)).toEqual([]);
  });

  it('a parsed layer carries its marks', () => {
    expect(parseMod(GOOD)!.marks).toEqual(['clock']);
  });
});
