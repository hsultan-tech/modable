import { useEffect, useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react'
import { RefreshCw, ArrowRight } from 'lucide-react'
import { useAppStore, InstalledApp } from '../stores/projectStore'
import { api } from '../api'
import { DashboardSidebar } from './DashboardSidebar'
import { CommandPalette, useCommandPalette, CommandAction } from './CommandPalette'
import { ApiKeyChangeModal } from './ProfileMenu'
import { SurfaceField } from './SurfaceField'

/* ---------- the rail ----------
   The whole hero is one stack on one axis: surface, name, metadata, and a
   shallow rail of apps beneath them, centred in the canvas to the right of
   the utility rail. The selected app sits at the rail's centre; the others
   step down in size and contrast along a gentle curve. Positions come from one
   continuous value, so every app glides along the rail together. */

/** One precise in-out: no overshoot, no bounce. */
const SWITCH_MS = 720
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
/** Signed shortest distance from a to b on a ring of n. */
const ringDelta = (d: number, n: number) => {
  const m = ((d % n) + n) % n
  return m > n / 2 ? m - n : m
}
const smoothstep = (a: number, b: number, v: number) => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

type Geo = { w: number; h: number; cx: number; heroCy: number; D: number; nameY: number; railY: number; spacing: number }

export function Dashboard({ onNavigateToHistory }: { onNavigateToHistory?: () => void }) {
  const {
    installedApps, setInstalledApps, setSelectedApp, isScanning, setScanning,
    setApiKey, injectionHistory,
  } = useAppStore()
  const commandPalette = useCommandPalette()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [picked, setPicked] = useState<number | null>(null)
  const [leaving, setLeaving] = useState(false)
  const engageTimer = useRef<ReturnType<typeof setTimeout>>()
  const heroRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLElement>(null)

  const scanApps = async () => {
    setScanning(true)
    try {
      const result = await api.getApps()
      if (result.success && result.apps) setInstalledApps(result.apps)
    } catch (err) {
      console.error('[Dashboard] Error fetching apps:', err)
    } finally {
      setScanning(false)
    }
  }

  useEffect(() => {
    scanApps()
    return () => clearTimeout(engageTimer.current)
  }, [])

  // Real layer counts come from what has actually been written — the server
  // reports modCount: 0 for every app, so grouping the history is the only
  // honest source for "how many layers does this app carry".
  const layersByApp = useMemo(() => {
    const counts = new Map<string, number>()
    for (const record of injectionHistory || []) {
      if (!record.success) continue
      counts.set(record.appName, (counts.get(record.appName) || 0) + 1)
    }
    return counts
  }, [injectionHistory])

  // Reachability is what the server reports, not what the app is built on:
  // Spotify is reachable through Spicetify while never being Electron. Apps
  // Modable can open come first; the rest keep their scan order after them.
  const reachableOf = (a: InstalledApp) => a.reachable ?? a.isElectron
  const apps = useMemo(
    () => [...installedApps].sort((a, b) => Number(reachableOf(b)) - Number(reachableOf(a))),
    [installedApps]
  )
  const n = apps.length
  const attached = apps.filter(reachableOf).length

  /* Until someone picks, the stage holds the surface Modable last wrote
     into — the one they are most likely to come back to. */
  const lastWritten = useMemo(() => {
    let at = 0, name: string | null = null
    for (const r of injectionHistory || []) if (r.success && r.timestamp > at) { at = r.timestamp; name = r.appName }
    const i = apps.findIndex(a => a.name === name)
    return i >= 0 ? i : 0
  }, [apps, injectionHistory])
  const sel = picked != null && picked < n ? picked : lastWritten
  const app = apps[sel] as InstalledApp | undefined
  const reachable = app ? reachableOf(app) : false
  const layers = app ? layersByApp.get(app.name) || 0 : 0
  const spicetify = app?.channel === 'spicetify'

  /* ---------- geometry ----------
     One vertical stack, centred horizontally on the stage (which already
     starts after the utility rail) and vertically in the space under the
     header. Every piece is placed from the same axis. */
  const [geo, setGeo] = useState<Geo>({ w: 1200, h: 800, cx: 600, heroCy: 360, D: 440, nameY: 610, railY: 750, spacing: 104 })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight
      const top = 112, bottom = h - 22
      const avail = bottom - top
      // the surface keeps its size; the name then sits tight under it
      const D = Math.max(200, Math.min(avail - 246, w * 0.4, 520))
      const below = 206 // name, metadata and rail under the surface
      // the group sits a little above true centre, where the eye expects it
      const y0 = Math.max(top - 24, top + Math.max(0, (avail - (D + below)) / 2) - 30)
      const nameY = y0 + D + 2
      /* Optical centre, measured. The usable canvas starts where the floating
         dock actually ends, not where its lane does; and the form's fixed
         three-quarter pose carries its front a little right of its box, which
         a small share of its own size takes back. Applied once to the shared
         axis, so the hero, name, metadata and rail move as one group. */
      const box = el.getBoundingClientRect()
      const dock = el.parentElement?.querySelector('.mdb-dock')?.getBoundingClientRect()
      const left = dock ? Math.min(0, dock.right - box.left) : 0
      const cx = (left + w) / 2 - D * 0.012
      setGeo({
        w, h, cx,
        heroCy: y0 + D / 2, D,
        nameY,
        railY: nameY + 140,
        spacing: Math.min(114, Math.max(72, w * 0.07)),
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---------- the orbit's position ---------- */
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])
  const [disp, setDisp] = useState(sel)
  const dispRef = useRef(sel)
  const animRaf = useRef(0)
  const dirRef = useRef(1)
  const setDispBoth = (v: number) => { dispRef.current = v; setDisp(v) }

  const glideTo = useCallback((target: number) => {
    cancelAnimationFrame(animRaf.current)
    const from = dispRef.current
    const to = from + (n ? ringDelta(target - from, n) : 0)
    if (to !== from) dirRef.current = Math.sign(to - from)
    if (reduce || Math.abs(to - from) < 1e-3) { setDispBoth(to); return }
    const start = performance.now()
    const dur = SWITCH_MS * Math.min(1.35, 0.75 + Math.abs(to - from) * 0.25)
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur)
      setDispBoth(from + (to - from) * easeInOut(k))
      if (k < 1) animRaf.current = requestAnimationFrame(tick)
    }
    animRaf.current = requestAnimationFrame(tick)
  }, [n, reduce])

  useEffect(() => { glideTo(sel) }, [sel, glideTo])
  useEffect(() => () => cancelAnimationFrame(animRaf.current), [])

  const choose = (i: number) => {
    if (leaving || !n) return
    setPicked(((i % n) + n) % n)
  }
  const stepBy = (d: number) => choose(sel + d)

  const handleLogout = () => setApiKey(null)

  /** The stage chooses a surface; the workspace is where it gets modified.
   *  Everything but the surface steps back first, so the hand-off to the
   *  workspace's field (the same renderer) reads as one continuous object. */
  const engage = (target: InstalledApp | undefined) => {
    if (!target || leaving || !reachableOf(target)) return
    if (reduce) {
      setSelectedApp(target)
      return
    }
    setLeaving(true)
    engageTimer.current = setTimeout(() => setSelectedApp(target), 380)
  }

  /** ←/→ step along the orbit; the palette and modals keep their own keys. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (commandPalette.isOpen || showApiKeyModal || leaving || n < 2) return
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      e.preventDefault()
      stepBy(e.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* Scroll or trackpad: accumulate, then step once per gesture beat, so a
     long trackpad swipe moves one app at a time instead of spinning. */
  const wheel = useRef({ acc: 0, last: 0 })
  const onWheel = (e: React.WheelEvent) => {
    if (leaving || n < 2) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    const now = performance.now()
    if (now - wheel.current.last < 420) return
    wheel.current.acc += d
    if (Math.abs(wheel.current.acc) > 48) {
      stepBy(wheel.current.acc > 0 ? 1 : -1)
      wheel.current = { acc: 0, last: now }
    }
  }

  /* Drag along the orbit: the nodes follow the pointer, and on release the
     nearest app settles into the slot. A drag never counts as a click. */
  const drag = useRef<{ x: number; base: number; moved: boolean; id: number } | null>(null)
  const dragged = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    if (leaving || n < 2 || e.button !== 0) return
    if ((e.target as HTMLElement).closest('.hs-head')) return
    drag.current = { x: e.clientX, base: dispRef.current, moved: false, id: e.pointerId }
    dragged.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 8) return
    if (!d.moved) {
      d.moved = true
      cancelAnimationFrame(animRaf.current)
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    // dragging right pulls the left-hand apps toward the slot
    setDispBoth(d.base - dx / geo.spacing)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) return
    dragged.current = true
    setTimeout(() => { dragged.current = false }, 0)
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    const target = ((Math.round(dispRef.current) % n) + n) % n
    if (target === sel) glideTo(sel)
    else setPicked(target)
  }

  const handleCommand = (action: CommandAction) => {
    switch (action.type) {
      case 'scan-apps':
        scanApps()
        break
      case 'view-history':
        onNavigateToHistory?.()
        break
      case 'change-api-key':
        setShowApiKeyModal(true)
        break
      case 'logout':
        handleLogout()
        break
      case 'select-app': {
        engage(installedApps.find(a => a.name === action.appName))
        break
      }
    }
  }

  /* ---------- drawing the rail ---------- */
  const { cx, heroCy, D, nameY, railY, spacing, w } = geo
  // a shallow bowl: the centre is nearest, the ends rise away from it
  const railAt = (u: number): [number, number] => [cx + u * spacing * (1 - 0.035 * Math.abs(u)), railY - 5 * u * u]
  const railPath = useMemo(() => {
    const pts: string[] = []
    for (let k = 0; k <= 48; k++) {
      const u = -2.7 + (5.4 * k) / 48
      const x = cx + u * spacing * (1 - 0.035 * Math.abs(u)), y = railY + 34 - 5 * u * u
      pts.push(`${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [cx, railY, spacing])

  return (
    <div className="mdb h-full w-full flex overflow-hidden">
      <DashboardSidebar
        compact
        onLogout={handleLogout}
        onRefresh={scanApps}
        onHistory={onNavigateToHistory}
        onOpenCommandPalette={commandPalette.open}
        onSettings={() => setShowApiKeyModal(true)}
      />

      <main
        ref={stageRef}
        className="hs flex-1 min-w-0"
        data-leaving={leaving ? '' : undefined}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* the one surface — the same renderer the workspace uses, so a
            switch here morphs the form and the hand-off carries it through */}
        {app && (
          <SurfaceField
            src={app.realIcon}
            emoji={app.icon}
            state="idle"
            variant="stage"
            focusRef={heroRef}
            className="hs-field"
          />
        )}

        <div className="titlebar-drag hs-drag" />

        <header className="hs-head">
          <div>
            <h1 className="hs-title">Rewrite what runs.</h1>
            <p className="hs-lede">Select a running app to rewrite its surface.</p>
            <p className="hs-sys">
              {attached === 0 ? 'No apps attached' : `${attached} ${attached === 1 ? 'app' : 'apps'} attached`}
            </p>
          </div>
          <button
            type="button"
            onClick={scanApps}
            disabled={isScanning}
            className="hs-scan"
            title="Look again for apps Modable can modify"
          >
            <RefreshCw size={12} className={isScanning ? 'animate-spin' : ''} />
            {isScanning ? 'Scanning…' : 'Scan machine'}
          </button>
        </header>

        {app ? (
          <>
            {/* the hero: the surface's own box is the click target */}
            <button
              ref={heroRef}
              type="button"
              className="hs-hero"
              // the stage variant's depth projects the form a little past its box,
              // so the box is drawn in from the layout slot to keep it clear of the name
              style={{ left: cx - D * 0.4875, top: heroCy - D * 0.4875, width: D * 0.975, height: D * 0.975 }}
              disabled={!reachable}
              onClick={() => !dragged.current && engage(app)}
              aria-label={reachable ? `Open ${app.name}` : `${app.name} is closed`}
            />

            {/* the rail: a hairline that fades at both ends, and the slot */}
            <svg className="hs-orbit" width={w} height={geo.h} aria-hidden>
              <defs>
                <linearGradient id="hs-rail-fade" gradientUnits="userSpaceOnUse" x1={cx - spacing * 2.7} y1="0" x2={cx + spacing * 2.7} y2="0">
                  <stop offset="0" stopColor="#f0ece6" stopOpacity="0" />
                  <stop offset="0.35" stopColor="#f0ece6" stopOpacity="0.12" />
                  <stop offset="0.5" stopColor="#f0ece6" stopOpacity="0.18" />
                  <stop offset="0.65" stopColor="#f0ece6" stopOpacity="0.12" />
                  <stop offset="1" stopColor="#f0ece6" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={railPath} fill="none" stroke="url(#hs-rail-fade)" strokeWidth="1" />
            </svg>

            {/* the slot: a few points that gather under the selected app each time
                one arrives — the surface's own material, not a tab underline */}
            <span className="hs-mark" key={`mark-${sel}`} style={{ left: cx, top: railY + 34 }} aria-hidden>
              {[-3, -2, -1, 0, 1, 2, 3].map(k => (
                <i key={k} style={{ ['--k' as string]: k, ['--a' as string]: k ? 0.62 - Math.abs(k) * 0.15 : 1 }} />
              ))}
            </span>

            {/* the apps, riding the rail */}
            <div className="hs-nodes">
              {apps.map((a, i) => {
                const d = ringDelta(i - disp, n)
                const ad = Math.abs(d)
                if (ad > 2.6) return null
                const [x, y] = railAt(d)
                const op = ad < 1 ? 1 - ad * 0.3 : Math.max(0, 0.7 - (ad - 1) * 0.27) * smoothstep(2.6, 2.1, ad)
                const sc = 1 - Math.min(ad, 2.5) * 0.13
                const ok = reachableOf(a)
                return (
                  <button
                    key={a.path}
                    type="button"
                    className="hs-node"
                    data-current={ad < 0.5 ? '' : undefined}
                    data-closed={!ok ? '' : undefined}
                    style={{
                      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(3)})`,
                      opacity: op,
                      pointerEvents: op < 0.12 ? 'none' : undefined,
                    }}
                    onClick={() => !dragged.current && (i === sel ? engage(a) : choose(i))}
                    aria-label={i === sel ? `Open ${a.name}` : `Show ${a.name}`}
                    aria-current={i === sel ? 'true' : undefined}
                  >
                    <span className="hs-node-i">
                      {a.realIcon ? <img src={a.realIcon} alt="" draggable={false} /> : a.icon}
                    </span>
                    <span className="hs-node-t">{a.name}</span>
                  </button>
                )
              })}
            </div>

            {/* the primary slot: the selected app's name, set on the orbit */}
            <div
              className="hs-caption"
              key={app.path}
              style={{ left: cx, top: nameY, ['--dir' as string]: dirRef.current }}
            >
              <button
                type="button"
                className="hs-name"
                disabled={!reachable}
                onClick={() => engage(app)}
              >
                <span className="hs-name-t">{app.name}</span>
                {reachable && <ArrowRight className="hs-arrow" aria-hidden />}
              </button>
              <p className="hs-meta">
                <span className={`hs-state ${reachable ? 'is-live' : ''}`}>
                  {!reachable ? 'Closed' : spicetify ? 'Ready' : 'Attached'}
                </span>
                <span className="hs-sep" aria-hidden>·</span>
                <span className="hs-mech">{spicetify ? 'SPICETIFY' : 'CDP'}</span>
                {app.version && <><span className="hs-sep" aria-hidden>·</span><span className="hs-ver">{app.version}</span></>}
                {layers > 0 && <><span className="hs-sep" aria-hidden>·</span><span className="hs-layers">{layers} {layers === 1 ? 'layer' : 'layers'}</span></>}
              </p>
              {!reachable && app.blockedBecause && <p className="hs-why">{app.blockedBecause}</p>}
            </div>
          </>
        ) : (
          <div className="hs-empty">
            <p className="hs-empty-t">{isScanning ? 'Looking for surfaces…' : 'No surfaces found yet'}</p>
            {!isScanning && <p className="hs-empty-s">Open the app you want to change, then scan again.</p>}
          </div>
        )}
      </main>

      <CommandPalette
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        onCommand={handleCommand}
      />

      <ApiKeyChangeModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />
    </div>
  )
}
