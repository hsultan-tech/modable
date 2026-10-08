/**
 * Every generated layer owns itself, and only itself.
 *
 * Generated layers used to be told to open with
 *   document.querySelectorAll('[data-modable]').forEach(el => el.remove())
 * so each new one deleted every other layer in the same app — a Word Count
 * layer destroyed a Discord → Notion Project sitting on the same page.
 *
 * Ownership is enforced here rather than trusted to the model. ownLayer()
 * wraps a generated layer, after it has been parsed, in a harness that:
 *   - gives it a stable id (gen-<slug of its NAME>), so the same modification
 *     run again replaces its previous instance and nothing else;
 *   - rewrites any broad [data-modable] selector in its code to its own
 *     [data-modable-layer="<id>"], so it cannot reach another layer's nodes;
 *   - stamps everything it creates with data-modable-layer="<id>";
 *   - keeps every other layer's teardown hook, even if the code clobbers
 *     window.__modableTeardown;
 *   - registers window.__modableTeardown[<id>], which removes exactly what it
 *     owns, and hands the code modable.onTeardown(fn) for its own listeners;
 *   - writes a sentinel mark (modable-layer:<id>) only once the layer has
 *     actually put something on the page, so verification can demand it.
 *
 * Hand-built flagship layers are never wrapped: each already cleans up only
 * its own prefix and hook.
 */

export const LAYER_MARK = 'modable-layer:'
const OPEN = '/*MODABLE_OWNED:'
const BODY_OPEN = '/*MODABLE_LAYER_BODY*/\n'
const BODY_CLOSE = '\n/*/MODABLE_LAYER_BODY*/'

/** "Word Count Display" → "gen-word-count-display". Deterministic per NAME. */
export function layerIdFor(name: string): string {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `gen-${slug || 'layer'}`
}

/** The id a wrapped layer carries, or null for anything else. */
export function ownedLayerId(code: string | undefined | null): string | null {
  const m = String(code || '').match(/^\/\*MODABLE_OWNED:([a-z0-9-]+)\*\//)
  return m ? m[1] : null
}

/** The model's own code inside a wrapped layer, or the code itself. */
export function unwrapOwned(code: string): string {
  const s = String(code || '')
  const a = s.indexOf(BODY_OPEN)
  const b = s.lastIndexOf(BODY_CLOSE)
  return ownedLayerId(s) && a !== -1 && b > a ? s.slice(a + BODY_OPEN.length, b) : s
}

/**
 * Any selector that names every Modable node narrowed to this layer's own.
 * `[data-modable]` on its own only ever appears in generated code as a
 * selector, and a layer has no business touching nodes it does not own.
 */
export function scopeSelectors(code: string, id: string): string {
  return code.replace(/\[\s*data-modable\s*\](?!\s*[=^$*~|])/g, `[data-modable-layer="${id}"]`)
}

/**
 * The harness. `marks` are the data-modable values the code claims; nodes
 * carrying them that appear later (a retry timer, a lazy panel) are stamped
 * too. Nodes another layer creates afterwards are never stamped: only those
 * created while this code runs, or carrying its own claimed marks.
 */
export function ownLayer(code: string, id: string, marks: string[] = []): { code: string; marks: string[] } {
  const body = scopeSelectors(unwrapOwned(code).trim(), id)
  const claims = marks.filter(m => !m.startsWith(LAYER_MARK))
  const sentinel = LAYER_MARK + id
  const wrapped = `${OPEN}${id}*/
(function () {
  var ID = ${JSON.stringify(id)};
  var SENTINEL = ${JSON.stringify(sentinel)};
  var CLAIMS = ${JSON.stringify(claims).replace(/</g, '\\u003c')};
  var hooks = (window.__modableTeardown = window.__modableTeardown || {});

  /* Replace the previous instance of this layer — and only this layer. */
  if (hooks[ID]) { try { hooks[ID](); } catch (e) {} }
  [].slice.call(document.querySelectorAll('[data-modable-layer="' + ID + '"]')).forEach(function (n) { n.remove(); });

  var cleanups = [];
  var addedClasses = [];
  var modable = { id: ID, onTeardown: function (fn) { if (typeof fn === 'function') cleanups.push(fn); } };
  function own(el) {
    if (el && el.nodeType === 1 && !el.hasAttribute('data-modable-layer')) el.setAttribute('data-modable-layer', ID);
  }
  function snapshot() {
    return [].slice.call(document.querySelectorAll('[data-modable], style, link[rel="stylesheet"]'));
  }
  function newClasses() {
    return [].slice.call(document.documentElement.classList).filter(function (c) {
      return classesBefore.indexOf(c) === -1 && c.indexOf('modable-') === 0;
    });
  }
  var before = snapshot();
  var classesBefore = [].slice.call(document.documentElement.classList);
  var otherHooks = {};
  Object.keys(hooks).forEach(function (k) { if (k !== ID) otherHooks[k] = hooks[k]; });

  /* Later nodes carrying this layer's own claimed marks belong to it. */
  var mo = new MutationObserver(function (records) {
    records.forEach(function (r) {
      [].forEach.call(r.addedNodes, function (n) {
        if (n.nodeType !== 1) return;
        [n].concat([].slice.call(n.querySelectorAll('[data-modable]'))).forEach(function (el) {
          if (CLAIMS.indexOf(el.getAttribute('data-modable')) !== -1) own(el);
        });
      });
    });
  });

  function teardown() {
    mo.disconnect();
    cleanups.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
    [].slice.call(document.querySelectorAll('[data-modable-layer="' + ID + '"]')).forEach(function (n) { n.remove(); });
    addedClasses.forEach(function (c) { document.documentElement.classList.remove(c); });
    var h = window.__modableTeardown;
    if (h && h[ID] === teardown) delete h[ID];
  }

  /* Never leave another layer without its teardown. */
  function keepOthers() {
    var h = (window.__modableTeardown = window.__modableTeardown || {});
    Object.keys(otherHooks).forEach(function (k) { if (h[k] !== otherHooks[k]) h[k] = otherHooks[k]; });
    return h;
  }

  var result;
  try {
    result = (function () {
${BODY_OPEN}${body}${BODY_CLOSE}
    })();
  } catch (e) {
    /* A layer that throws takes back only what it made. */
    snapshot().forEach(function (el) { if (before.indexOf(el) === -1) own(el); });
    addedClasses = newClasses();
    teardown();
    keepOthers();
    throw e;
  }

  /* Everything this run created is this layer's. */
  snapshot().forEach(function (el) { if (before.indexOf(el) === -1) own(el); });
  CLAIMS.forEach(function (m) {
    [].slice.call(document.querySelectorAll('[data-modable]')).forEach(function (el) {
      if (el.getAttribute('data-modable') === m) own(el);
    });
  });
  addedClasses = newClasses();
  mo.observe(document.documentElement, { childList: true, subtree: true });
  keepOthers()[ID] = teardown;

  /* Proof it took: only once the layer has put something of its own on the page. */
  var mine = [].slice.call(document.querySelectorAll('[data-modable-layer="' + ID + '"]'));
  if (mine.some(function (el) { return el.getAttribute('data-modable') !== SENTINEL; })) {
    var s = document.createElement('meta');
    s.setAttribute('data-modable', SENTINEL);
    s.setAttribute('data-modable-layer', ID);
    (document.head || document.documentElement).appendChild(s);
  }
  return result;
})();`
  return { code: wrapped, marks: [...claims, sentinel] }
}
