import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pickTarget } = require('../lib/pickTarget.js');

/**
 * Two visible windows, the way a Slack with a call open actually lists. This
 * fixture is the whole point: with more than one candidate, an unpinned
 * selection is a coin toss.
 */
const TWO_WINDOWS = [
  { id: 'DEVTOOLS', type: 'page', url: 'devtools://devtools/bundled/x.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/DEVTOOLS' },
  { id: 'MAIN', type: 'page', url: 'https://app.slack.com/client/T1/C1', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/MAIN' },
  { id: 'CALL', type: 'page', url: 'https://app.slack.com/free-willy/T1', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/CALL' },
];

describe('pickTarget — unpinned selection', () => {
  it('skips devtools and picks a real window', () => {
    const { target, error } = pickTarget(TWO_WINDOWS);
    expect(error).toBeNull();
    expect(target.id).toBe('MAIN');
  });

  it('errors rather than returning nothing when no window is attachable', () => {
    const { target, error } = pickTarget([]);
    expect(target).toBeNull();
    expect(error).toMatch(/Start the application with Modable/);
  });
});

describe('pickTarget — the pin', () => {
  it('read and write resolve to the same window', () => {
    // What /api/probe does, then what /api/inject does with what it returned.
    const read = pickTarget(TWO_WINDOWS);
    const write = pickTarget(TWO_WINDOWS, read.target.id);
    expect(write.error).toBeNull();
    expect(write.target.id).toBe(read.target.id);
  });

  it('honours the pin even when it is not the window it would have chosen', () => {
    const { target, error } = pickTarget(TWO_WINDOWS, 'CALL');
    expect(error).toBeNull();
    expect(target.id).toBe('CALL');
  });

  it('refuses a vanished pin instead of substituting another window', () => {
    // The pinned window closed mid-run; MAIN and CALL are still available and
    // must NOT be silently written to in its place.
    const { target, error } = pickTarget(TWO_WINDOWS, 'CLOSED');
    expect(target).toBeNull();
    expect(error).toMatch(/no longer open/);
  });

  it('refuses a pin whose window can no longer be attached to', () => {
    const noSocket = [{ id: 'MAIN', type: 'page', url: 'https://app.slack.com', webSocketDebuggerUrl: undefined }];
    const { target, error } = pickTarget(noSocket, 'MAIN');
    expect(target).toBeNull();
    expect(error).toMatch(/no longer open/);
  });
});

/**
 * How Notion 7.x actually lists itself: a hidden /blank page and a 36px tab bar
 * come before the document window, and one target never answers. First-match
 * picked the hidden page, so layers landed somewhere nobody could see.
 */
const NOTION = [
  { id: 'BLANK', type: 'page', url: 'https://app.notion.com/blank?tabCount=1', webSocketDebuggerUrl: 'ws://x/BLANK' },
  { id: 'DOC', type: 'page', url: 'https://app.notion.com/p/3eb870cf', webSocketDebuggerUrl: 'ws://x/DOC' },
  { id: 'TABS', type: 'page', url: 'file:///Applications/Notion.app/tabs/index.html', webSocketDebuggerUrl: 'ws://x/TABS' },
  { id: 'SILENT', type: 'page', url: '', webSocketDebuggerUrl: 'ws://x/SILENT' },
];

describe('pickTarget — live viewports', () => {
  it('picks the document window over hidden and tiny ones', () => {
    const viewports = {
      BLANK: { visible: false, w: 0, h: 0 },
      DOC: { visible: true, w: 1320, h: 823 },
      TABS: { visible: true, w: 1320, h: 36 },
    };
    expect(pickTarget(NOTION, null, viewports).target.id).toBe('DOC');
  });

  it('falls back to first-match when no window answered', () => {
    expect(pickTarget(NOTION, null, {}).target.id).toBe('BLANK');
  });

  it('finds the document when Modable covers the app (macOS reports every window hidden)', () => {
    const viewports = {
      BLANK: { visible: false, focus: false, w: 0, h: 0 },
      DOC: { visible: false, focus: true, w: 1320, h: 823 },
      TABS: { visible: true, focus: false, w: 1320, h: 36 },
    };
    expect(pickTarget(NOTION, null, viewports).target.id).toBe('DOC');
  });

  it('prefers the focused covered window, then the largest', () => {
    const two = [...NOTION, { id: 'DOC2', type: 'page', url: 'https://app.notion.com/p/x', webSocketDebuggerUrl: 'ws://x/DOC2' }];
    expect(pickTarget(two, null, {
      DOC: { visible: false, focus: false, w: 1800, h: 1000 },
      DOC2: { visible: false, focus: true, w: 1200, h: 800 },
    }).target.id).toBe('DOC2');
    expect(pickTarget(two, null, {
      DOC: { visible: false, w: 1800, h: 1000 },
      DOC2: { visible: false, w: 1200, h: 800 },
    }).target.id).toBe('DOC');
  });

  it('never lets viewports override a pin', () => {
    const viewports = { DOC: { visible: true, w: 1320, h: 823 } };
    expect(pickTarget(NOTION, 'TABS', viewports).target.id).toBe('TABS');
  });
});
