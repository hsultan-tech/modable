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
    const hit = expected.filter(m => after.names.includes(m));
    return { verified: hit.length === expected.length, matched: hit };
  }
  const fresh = after.names.filter(n => !before.names.includes(n));
  return { verified: fresh.length > 0 || after.count > before.count, matched: fresh };
}

/**
 * Undo a layer.
 *
 * Deliberately narrow, and worth being honest about: this removes the nodes a
 * layer added and the documentElement classes Modable is known to set. It does
 * NOT undo edits a layer made to the application's own existing nodes — a
 * restyled sidebar, a renamed button, a removed element stay as the layer left
 * them. Those have no record to restore from, and inventing one is a bigger
 * piece of work than the MVP needs. Reloading the target application clears
 * anything this misses.
 */
function revertScript(marks) {
  const list = JSON.stringify(Array.isArray(marks) ? marks : []);
  return `(function(){
    var wanted = ${list};

    // A layer with listeners or observers registers how to take them down,
    // keyed by a prefix of its marks. Removing its nodes alone would leave
    // those running against a page they no longer belong to.
    var hooks = window.__modableTeardown || {};
    var tornDown = [];
    Object.keys(hooks).forEach(function(key){
      var ours = !wanted.length || wanted.some(function(m){ return m.indexOf(key) === 0; });
      if (!ours) return;
      try { hooks[key](); } catch (e) {}
      delete hooks[key];
      tornDown.push(key);
    });

    var sel = wanted.length
      ? wanted.map(function(m){ return '[data-modable="' + m + '"]'; }).join(',')
      : '[data-modable]';
    var nodes = document.querySelectorAll(sel);
    var removed = 0;
    for (var i = 0; i < nodes.length; i++) { nodes[i].remove(); removed++; }

    // A layer that inverted the theme and then failed leaves this class behind
    // with its stylesheet already gone — the application is stuck looking wrong
    // with no control to put it back.
    var stripped = [];
    var classes = Array.prototype.slice.call(document.documentElement.classList);
    for (var j = 0; j < classes.length; j++) {
      if (classes[j].indexOf('modable-') === 0) {
        document.documentElement.classList.remove(classes[j]);
        stripped.push(classes[j]);
      }
    }
    return { removed: removed, stripped: stripped, tornDown: tornDown, remaining: document.querySelectorAll('[data-modable]').length };
  })()`;
}

module.exports = { verdict, revertScript };
