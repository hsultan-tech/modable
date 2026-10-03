/**
 * Choose which page inside the target application to talk to.
 *
 * Split out of server.js so it can be tested without a running app, and so the
 * three CDP calls in one run (read, write, confirm) can be made to agree.
 *
 * They used not to. Each call re-ran this selection independently and took the
 * first match out of an unordered list, so an application showing more than one
 * window — a Slack with a call up, or a second workspace — could be read as
 * window A, written to as window B and confirmed against C. The layer was
 * correct and landed nowhere visible.
 *
 * The fix is a pin: the read returns the id it settled on, and every later call
 * in that run demands that exact id. A pinned target that has since closed is
 * an error, never a cue to quietly pick a different window.
 */

/** Windows a person can actually see; the rest are devtools and background pages. */
function isVisiblePage(p) {
  return (
    p.type === 'page' &&
    p.url &&
    !p.url.startsWith('devtools://') &&
    !p.url.startsWith('chrome://') &&
    !p.url.startsWith('about:') &&
    !!p.webSocketDebuggerUrl
  );
}

/**
 * The window a person is looking at, from what each one reported about itself.
 *
 * URL rules cannot answer this. Notion lists a hidden `/blank` page (0×0) and a
 * 36px tab bar ahead of the document window, all ordinary https/file pages —
 * first-match wrote layers into the hidden one. A window's own viewport is the
 * only reliable signal, so the largest visible one wins.
 *
 * @param {Array} pages
 * @param {Object<string, {visible: boolean, w: number, h: number}>} viewports
 *        keyed by target id; a window that did not answer is simply absent
 */
function largestVisible(pages, viewports) {
  let best = null;
  let bestArea = 0;
  for (const p of pages) {
    const v = viewports[p.id];
    // A strip (Notion's 36px tab bar) can be visible while the document
    // under it is covered; it is never where a layer belongs.
    if (!v || !v.visible || (v.h || 0) < 120) continue;
    const area = (v.w || 0) * (v.h || 0);
    if (area > bestArea) { best = p; bestArea = area; }
  }
  return best || coveredWindow(pages, viewports);
}

/**
 * No window says it is visible. macOS reports a window covered by another
 * one — Modable's own, while the user types into it — as hidden, so this is
 * the ordinary case for any app Modable is not beside. The focused window
 * (the app's active one) wins, then the largest; a 0×0 window (Notion's
 * hidden /blank page) never does.
 */
function coveredWindow(pages, viewports) {
  let best = null;
  let bestScore = 0;
  for (const p of pages) {
    const v = viewports[p.id];
    const area = v ? (v.w || 0) * (v.h || 0) : 0;
    if (!area || (v.h || 0) < 120) continue;
    const score = (v.focus ? 1e9 : 0) + area;
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/**
 * @param {Array} pages     what CDP's /json listed
 * @param {string} [pinned] the id this run is already committed to, if any
 * @param {Object} [viewports] live viewport per target id, when it was read
 * @returns {{target: object|null, error: string|null}}
 */
function pickTarget(pages, pinned, viewports) {
  const list = Array.isArray(pages) ? pages : [];

  if (pinned) {
    const target = list.find(p => p.id === pinned && p.webSocketDebuggerUrl);
    if (target) return { target, error: null };
    // Substituting another window here is what made the original bug invisible.
    return {
      target: null,
      error:
        'The window this layer was written for is no longer open. ' +
        'Read the application again before writing to it.',
    };
  }

  const candidates = list.filter(isVisiblePage);
  const target =
    (viewports && largestVisible(candidates, viewports)) ||
    candidates[0] ||
    list.find(p => p.webSocketDebuggerUrl) ||
    null;
  if (!target) {
    return {
      target: null,
      error: 'No attachable window. Start the application with Modable first.',
    };
  }
  return { target, error: null };
}

module.exports = { pickTarget, isVisiblePage, largestVisible };
