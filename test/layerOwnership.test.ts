// @vitest-environment jsdom
/**
 * Layer ownership, run against a real DOM: every layer owns only itself.
 *
 * Generated layers go through the same harness Modable injects (ownLayer),
 * verification through the same probe and verdict the server runs, and
 * rollback through the same revertScript. Flagships are their real source.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createRequire } from 'module'
import { ownLayer, layerIdFor, ownedLayerId, unwrapOwned, scopeSelectors } from '../src/agent/layerOwnership'
import { extractMarks } from '../src/agent/parseMod'
import { matchCapability } from '../src/agent/capabilities'
import notionSpatial from '../src/agent/layers/notionSpatial.js?raw'
import notionDiscordProject from '../src/agent/layers/notionDiscordProject.js?raw'

const { verdict, revertScript, MARKS_PROBE } = createRequire(import.meta.url)('../lib/verify.js')

type Snap = { count: number; names: string[]; owned: Record<string, string[]> }
const run = (code: string) => (0, eval)(code)
const probe = (): Snap => run(MARKS_PROBE)
const marksOf = (prefix: string) =>
  [...document.querySelectorAll('[data-modable]')].map(e => e.getAttribute('data-modable')!).filter(n => n.startsWith(prefix))

/** A generated layer as the model writes it — including the old broad cleanup. */
function modelCode(mark: string, text: string, opts: { broad?: boolean; throws?: boolean; empty?: boolean } = {}) {
  return `(function(){
  ${opts.broad === false ? '' : "document.querySelectorAll('[data-modable]').forEach(function(el){ el.remove(); });"}
  ${opts.empty ? '' : `var b = document.createElement('button');
  b.setAttribute('data-modable', '${mark}');
  b.textContent = '${text}';
  document.body.appendChild(b);
  var st = document.createElement('style');
  st.setAttribute('data-modable', '${mark}-style');
  st.textContent = '.x{}';
  document.head.appendChild(st);`}
  ${opts.throws ? "throw new Error('boom');" : ''}
})();`
}

/** What Modable does: own it, inject it, verify it with the server's verdict. */
function inject(name: string, code: string, id = layerIdFor(name)) {
  const layer = ownLayer(code, id, extractMarks(code))
  const before = probe()
  let threw = false
  try { run(layer.code) } catch { threw = true }
  const after = probe()
  return { ...layer, id, threw, verified: !threw && verdict(layer.marks, before, after).verified }
}

function notionPage() {
  document.body.innerHTML = `
    <div class="notion-sidebar"></div>
    <div class="notion-topbar"><div class="notion-topbar-action-buttons"><div><div role="button" aria-label="Share">Share</div></div></div></div>
    <div class="notion-frame"><div class="notion-scroller">
      <h1 contenteditable>Roadmap</h1>
      <div class="notion-page-content">
        <div data-block-id="b1" class="notion-header-block">Goals</div>
        <div data-block-id="b2" class="notion-text-block">Ship it.</div>
      </div>
    </div></div>`
}

const project = {
  payload: {
    version: 1, id: 'dnp-channel-1', title: 'Launch', overview: 'Getting the launch out.',
    tasks: [{ text: 'Fix auth', owner: 'Hamad', sources: [{ app: 'discord', serverId: '1111111', channelId: '2222222', channelName: 'launch', messageId: '3333333', author: 'Sara', timestamp: '2026-10-02T14:00:00.000Z' }] }],
    decisions: [], blockers: [], questions: [], resources: [],
    origin: { app: 'discord', kind: 'channel', serverId: '1111111', serverName: 'S', channelId: '2222222', channelName: 'launch', messageCount: 2, firstAt: '2026-10-02T14:00:00.000Z', lastAt: '2026-10-02T14:05:00.000Z', lastMessageId: '3333333', extractedAt: '2026-10-03T00:00:00.000Z' },
  },
  destination: { title: 'Roadmap' },
}
const projectCode = notionDiscordProject.replace('/*MODABLE_CONFIG*/null', JSON.stringify(project))
const PROJECT_MARKS = ['discord-notion-project-style', 'discord-notion-project-switch', 'discord-notion-project-view']
const SPATIAL_MARKS = ['notion-spatial-style', 'notion-spatial-toggle']

beforeEach(() => {
  // Earlier tests' layers must not leak into the next one.
  const hooks = (window as any).__modableTeardown || {}
  Object.keys(hooks).forEach(k => { try { hooks[k]() } catch { /* already gone */ } })
  ;(window as any).__modableTeardown = {}
  document.head.innerHTML = ''
  document.body.innerHTML = '<main id="app">native</main>'
  document.documentElement.className = ''
  // jsdom lacks these; the flagships use them for layout and motion only.
  ;(window as any).matchMedia = () => ({ matches: true })
  ;(window as any).ResizeObserver = class { observe() {} disconnect() {} }
  ;(Element.prototype as any).animate = function () { return { onfinish: null, cancel() {} } }
})

describe('generated layers own only themselves', () => {
  it('1. a generated layer exists and is verified by its own marks', () => {
    const a = inject('Word Counter', modelCode('word-count', 'A1'))
    expect(a.verified).toBe(true)
    expect(document.querySelectorAll('[data-modable-layer="gen-word-counter"]').length).toBe(3) // button, style, sentinel
    expect(a.marks).toContain('modable-layer:gen-word-counter')
  })

  it('2. injecting layer B — even one that still does broad cleanup — leaves A intact', () => {
    inject('Word Counter', modelCode('word-count', 'A1'))
    const b = inject('Clock', modelCode('clock', 'B1', { broad: true }))
    expect(b.verified).toBe(true)
    expect(document.querySelector('[data-modable="word-count"]')?.textContent).toBe('A1')
    expect(document.querySelector('[data-modable="clock"]')?.textContent).toBe('B1')
    expect(document.getElementById('app')?.textContent).toBe('native')
  })

  it('3. reinjecting A replaces only A', () => {
    inject('Word Counter', modelCode('word-count', 'A1'))
    inject('Clock', modelCode('clock', 'B1'))
    const a2 = inject('Word Counter', modelCode('word-count', 'A2'))
    expect(a2.verified).toBe(true)
    expect([...document.querySelectorAll('[data-modable="word-count"]')].map(e => e.textContent)).toEqual(['A2'])
    expect(document.querySelector('[data-modable="clock"]')?.textContent).toBe('B1')
  })

  it('4. reverting A leaves B', () => {
    const a = inject('Word Counter', modelCode('word-count', 'A1'))
    inject('Clock', modelCode('clock', 'B1'))
    const r = run(revertScript(a.marks))
    expect(r.tornDown).toEqual(['gen-word-counter'])
    expect(document.querySelector('[data-modable-layer="gen-word-counter"]')).toBeNull()
    expect(document.querySelector('[data-modable="clock"]')?.textContent).toBe('B1')
    expect((window as any).__modableTeardown['gen-clock']).toBeTypeOf('function')
  })

  it('5. a failed B is rolled back alone, and A survives', () => {
    inject('Word Counter', modelCode('word-count', 'A1'))
    const b = inject('Clock', modelCode('clock', 'B1', { throws: true }))
    expect(b.threw).toBe(true)
    run(revertScript(b.marks)) // what ModPreview's fail() does
    expect(document.querySelector('[data-modable="clock"]')).toBeNull()
    expect(document.querySelector('[data-modable="word-count"]')?.textContent).toBe('A1')

    const silent = inject('Clock', modelCode('clock', '', { empty: true }))
    expect(silent.verified).toBe(false) // ran, made nothing: no sentinel, no pass
    run(revertScript(silent.marks))
    expect(document.querySelector('[data-modable="word-count"]')?.textContent).toBe('A1')
  })

  it('6. repairing B (same id) replaces B only', () => {
    inject('Word Counter', modelCode('word-count', 'A1'))
    const b = inject('Clock', modelCode('clock', 'B1'))
    // The repaired layer keeps the failed layer's id even under a new NAME.
    const fixed = inject('Clock (reworked)', modelCode('clock-v2', 'B2'), ownedLayerId(b.code)!)
    expect(fixed.verified).toBe(true)
    expect(document.querySelector('[data-modable="clock"]')).toBeNull()
    expect(document.querySelector('[data-modable="clock-v2"]')?.textContent).toBe('B2')
    expect(document.querySelector('[data-modable="word-count"]')?.textContent).toBe('A1')
  })

  it("7. another layer's marks cannot satisfy B's verification", () => {
    inject('Panel A', modelCode('panel', 'A'))
    // B claims the same mark name but creates nothing.
    const bCode = `(function(){ if (false) { var e = document.createElement('div'); e.setAttribute('data-modable', 'panel'); } })();`
    const b = inject('Panel B', bCode)
    expect(b.marks).toContain('panel')
    expect(b.verified).toBe(false)
  })

  it("never lets a layer wipe another layer's teardown hook", () => {
    inject('Word Counter', modelCode('word-count', 'A1'))
    inject('Rude', `(function(){ window.__modableTeardown = {}; var d = document.createElement('div'); d.setAttribute('data-modable','rude'); document.body.appendChild(d); })();`)
    expect((window as any).__modableTeardown['gen-word-counter']).toBeTypeOf('function')
    expect((window as any).__modableTeardown['gen-rude']).toBeTypeOf('function')
  })

  it('removes only the html classes and listeners it added', () => {
    document.documentElement.classList.add('modable-other')
    const t = inject('Theme', `(function(){
      var s = document.createElement('style'); s.setAttribute('data-modable','theme-invert'); document.head.appendChild(s);
      document.documentElement.classList.add('modable-inverted');
      var n = 0; function onKey(){ n++; } document.addEventListener('keydown', onKey);
      modable.onTeardown(function(){ document.removeEventListener('keydown', onKey); window.__themeTornDown = true; });
    })();`)
    expect(t.verified).toBe(true)
    run(revertScript(t.marks))
    expect(document.documentElement.classList.contains('modable-inverted')).toBe(false)
    expect(document.documentElement.classList.contains('modable-other')).toBe(true)
    expect((window as any).__themeTornDown).toBe(true)
  })

  it('a revert with no marks removes nothing; only an explicit remove-all removes everything', () => {
    inject('Word Counter', modelCode('word-count', 'A1'))
    expect(run(revertScript([])).removed).toBe(0)
    expect(document.querySelector('[data-modable="word-count"]')).not.toBeNull()
    run(revertScript([], { all: true }))
    expect(document.querySelectorAll('[data-modable]').length).toBe(0)
  })
})

describe('flagships and generated layers coexist', () => {
  it('8. Spatial Mode + a generated layer: neither removes the other', () => {
    notionPage()
    run(notionSpatial)
    expect(verdict(SPATIAL_MARKS, { count: 0, names: [] }, probe()).verified).toBe(true)
    const w = inject('Word Counter', modelCode('word-count', 'A1'))
    expect(w.verified).toBe(true)
    expect(marksOf('notion-spatial').sort()).toEqual(SPATIAL_MARKS)

    run(revertScript(w.marks))
    expect(marksOf('notion-spatial').sort()).toEqual(SPATIAL_MARKS)
    const again = inject('Word Counter', modelCode('word-count', 'A2'))
    run(revertScript(SPATIAL_MARKS))
    expect(marksOf('notion-spatial')).toEqual([])
    expect(document.querySelector('[data-modable="word-count"]')?.textContent).toBe('A2')
    expect(again.verified).toBe(true)
  })

  it('9. Discord → Notion Project + a generated Notion layer coexist', () => {
    notionPage()
    run(projectCode)
    expect(verdict(PROJECT_MARKS, { count: 0, names: [] }, probe()).verified).toBe(true)
    const projectNodes = marksOf('discord-notion-project').length
    const w = inject('Word Counter', modelCode('word-count', 'A1', { broad: true }))
    expect(w.verified).toBe(true)
    expect(marksOf('discord-notion-project').length).toBe(projectNodes)

    run(revertScript(w.marks))
    expect(marksOf('discord-notion-project').length).toBe(projectNodes)
    expect((window as any).__modableTeardown['discord-notion-project']).toBeTypeOf('function')
  })

  it('10. Spatial Mode setup and cleanup never touch the project', () => {
    notionPage()
    run(projectCode)
    const projectNodes = marksOf('discord-notion-project').length
    run(notionSpatial)
    run(notionSpatial) // re-run replaces itself
    expect(marksOf('discord-notion-project').length).toBe(projectNodes)
    expect(marksOf('notion-spatial').sort()).toEqual(SPATIAL_MARKS)
    run(revertScript(SPATIAL_MARKS))
    expect(marksOf('notion-spatial')).toEqual([])
    expect(marksOf('discord-notion-project').length).toBe(projectNodes)
    run(revertScript(PROJECT_MARKS))
    expect(document.querySelectorAll('[data-modable]').length).toBe(0)
    expect(document.querySelectorAll('.notion-page-content > [data-block-id]').length).toBe(2)
  })
})

describe('the harness itself', () => {
  it('narrows broad selectors to the layer and round-trips its code', () => {
    const code = "document.querySelectorAll('[data-modable]'); x.closest(\"[data-modable]\"); q('[data-modable=\"keep\"]');"
    const scoped = scopeSelectors(code, 'gen-x')
    expect(scoped).not.toMatch(/\[data-modable\]/)
    expect(scoped).toContain('[data-modable="keep"]')
    const w = ownLayer(modelCode('a', 'A'), 'gen-a', ['a'])
    expect(ownedLayerId(w.code)).toBe('gen-a')
    expect(unwrapOwned(w.code)).toContain("setAttribute('data-modable', 'a')")
    expect(layerIdFor('Word Count Display')).toBe('gen-word-count-display')
    expect(layerIdFor('Notion Spatial')).toBe('gen-notion-spatial') // never a flagship's own key
  })

  it('11. capability routing is unchanged', () => {
    expect(matchCapability('Notion', 'turn this page into spatial mode')?.capabilityId).toBe('notion.spatial-mode')
    expect(matchCapability('Discord', 'turn this into a Notion project')?.capabilityId).toBe('crossapp.discord-to-notion-project')
    expect(matchCapability('Notion', 'add a word counter to this page')).toBeNull()
  })
})
