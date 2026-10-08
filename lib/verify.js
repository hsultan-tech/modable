/**
 * Deciding whether a layer took, and taking it back off if it did not.
 *
 * Split out of server.js so both can be tested without a running application.
 */

/**
 * Did the layer we just wrote actually take?
 *
 * Counting [data-modable] nodes was never an answer to that question, only to
 * "is any Modable layer present". A layer that added nothing passed on the
 * strength of a mark an earlier layer had left behind.
 *
 * Scoped to the layer instead:
 *  - it claimed marks, so EVERY one of them must be on the page now.
 *  - it claimed none we could read, so fall back to demanding something on the
 *    page that was not there before. Weaker, but still not satisfiable by a
 *    stale mark sitting untouched.
 *
 * `every`, not `some`, and the difference is not academic. A theme layer claims
 * two marks: the <style> that inverts the application and the toggle that puts
 * it back. Accepting one of them accepts the run where the style was appended
 * and the toggle never placed — the application inverted with no control to
 * undo it, recorded as a success. That is the exact state this phase exists to
 * prevent, so a partial layer counts as a failure.
 *
 * The cost is a layer whose placement ladder tags its branches with different
 * names, where only the branch that ran can leave a mark. That is rarer than
 * the half-applied theme (the prompt's own ladder reuses one name across its
 * rungs), and it fails safe: an unverified layer is reverted and reported,
 * never left half-on.
 */
function verdict(expected, before, after) {
  if (expected && expected.length) {
    // A generated layer claims its own sentinel (modable-layer:<id>); then
    // every claimed mark must be on a node THAT layer owns. The same mark
    // name on another layer's node proves nothing about this one.
    const layer = layerOf(expected);
    const pool = layer ? ((after.owned && after.owned[layer]) || []) : after.names;
    const hit = expected.filter(m => pool.includes(m));
    return { verified: hit.length === expected.length, matched: hit };
  }
  const fresh = after.names.filter(n => !before.names.includes(n));
  return { verified: fresh.length > 0 || after.count > before.count, matched: fresh };
}

/**
 * Every data-modable value currently on the page, for before/after comparison,
 * and which generated layer owns each one (data-modable-layer), so a layer is
 * only ever verified by its own marks.
 */
const MARKS_PROBE = `(function(){
  var nodes = document.querySelectorAll('[data-modable]');
  var names = [];
  var owned = {};
  for (var i = 0; i < nodes.length; i++) {
    var name = nodes[i].getAttribute('data-modable') || '?';
    names.push(name);
    var layer = nodes[i].getAttribute('data-modable-layer');
    if (layer) (owned[layer] = owned[layer] || []).push(name);
  }
  return { count: nodes.length, names: names, owned: owned };
})()`;

const LAYER_MARK = 'modable-layer:';

/** The generated layer a list of marks belongs to, from its sentinel. */
function layerOf(marks) {
  const m = (Array.isArray(marks) ? marks : []).find(x => typeof x === 'string' && x.indexOf(LAYER_MARK) === 0);
  return m ? m.slice(LAYER_MARK.length) : null;
}

/**
 * Undo one layer — never another.
 *
 *  - A generated layer (its marks carry modable-layer:<id>) is undone by its
 *    own teardown and by removing the nodes it owns, [data-modable-layer=id].
 *    Its teardown also removes any modable-* class it put on <html>.
 *  - A flagship is undone by the teardown hook its marks name (the longest
 *    key equal to a mark or prefixing it at a "-") and by removing nodes
 *    carrying its marks that no generated layer owns.
 *  - No marks undoes nothing. Removing every Modable node and hook is only
 *    ever done when asked for explicitly ({ all: true }).
 *
 * Deliberately narrow, and worth being honest about: this does NOT undo edits
 * a layer made to the application's own existing nodes — a restyled sidebar,
 * a renamed button, a removed element stay as the layer left them. Reloading
 * the target application clears anything this misses.
 */
function revertScript(marks, opts) {
  const list = Array.isArray(marks) ? marks.filter(m => typeof m === 'string' && m) : [];
  const all = !!(opts && opts.all);
  const layer = layerOf(list);
  return `(function(){
    var wanted = ${JSON.stringify(list)};
    var all = ${all ? 'true' : 'false'};
    var layer = ${JSON.stringify(layer)};
    var hooks = window.__modableTeardown || {};
    var tornDown = [];
    function tear(key) {
      try { hooks[key](); } catch (e) {}
      delete hooks[key];
      tornDown.push(key);
    }

    var nodes = [];
    if (all) {
      Object.keys(hooks).forEach(tear);
      nodes = document.querySelectorAll('[data-modable]');
    } else if (layer) {
      if (hooks[layer]) tear(layer);
      nodes = document.querySelectorAll('[data-modable-layer="' + layer + '"]');
    } else if (wanted.length) {
      // A layer with listeners or observers registers how to take them down,
      // keyed by the prefix of its marks. Each mark belongs to its most
      // specific owner — "notion-spatial-toggle" is notion-spatial's, never a
      // layer keyed "notion".
      var keys = Object.keys(hooks);
      var owners = {};
      wanted.forEach(function(m){
        var best = '';
        keys.forEach(function(key){
          if ((m === key || m.indexOf(key + '-') === 0) && key.length > best.length) best = key;
        });
        if (best) owners[best] = true;
      });
      keys.forEach(function(key){ if (owners[key]) tear(key); });
      nodes = document.querySelectorAll(wanted.map(function(m){
        return '[data-modable="' + m.replace(/"/g, '\\"') + '"]:not([data-modable-layer])';
      }).join(','));
    }
    var removed = 0;
    for (var i = 0; i < nodes.length; i++) { nodes[i].remove(); removed++; }

    // Only the explicit remove-everything strips classes it did not record;
    // a generated layer's own teardown removes the classes it added.
    var stripped = [];
    if (all) {
      var classes = Array.prototype.slice.call(document.documentElement.classList);
      for (var j = 0; j < classes.length; j++) {
        if (classes[j].indexOf('modable-') === 0) {
          document.documentElement.classList.remove(classes[j]);
          stripped.push(classes[j]);
        }
      }
    }
    return { removed: removed, stripped: stripped, tornDown: tornDown, remaining: document.querySelectorAll('[data-modable]').length };
  })()`;
}

module.exports = { verdict, revertScript, layerOf, LAYER_MARK, MARKS_PROBE };
