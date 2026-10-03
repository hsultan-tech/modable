import { useMemo } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { InstalledApp, InjectionStage } from '../stores/projectStore'

/* ----------------------------------------------------------------
   The live trace.

   This used to live with the surface field, which rendered a full-width
   waveform per target. That read as fake telemetry at dashboard scale, so the
   field is a registry of targets now and the trace belongs here — the one
   place a signal is genuinely the subject: the surface being worked.
   ---------------------------------------------------------------- */

type LaneState = 'attached' | 'writing' | 'closed'

/** Deterministic per-app noise, so a target's trace is always its own. */
function seeded(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5
    return ((h >>> 0) % 10000) / 10000
  }
}

const TILE = 200
const MID = 13

/**
 * One tile of waveform, repeated twice.
 *
 * The last point is pinned back to the first so that scrolling the path by
 * exactly one tile width leaves no seam.
 */
function tracePath(name: string, live: boolean): string {
  const rand = seeded(name)
  const steps = 52
  const dx = TILE / steps
  const amp = live ? 5.4 + rand() * 2.6 : 0.22

  const ys: number[] = []
  for (let i = 0; i < steps; i++) {
    if (live) {
      const a = Math.sin((i / steps) * Math.PI * 2 * (1 + Math.round(rand() * 2)))
      const b = Math.sin((i / steps) * Math.PI * 2 * 7 + rand() * 3) * 0.3
      ys.push(MID - (a + b) * amp - (rand() - 0.5) * 1.5)
    } else {
      ys.push(MID + (rand() - 0.5) * amp)
    }
  }
  ys.push(ys[0])

  const pts: string[] = []
  for (let tile = 0; tile < 2; tile++) {
    for (let i = 0; i <= steps; i++) {
      if (tile === 1 && i === 0) continue
      pts.push(`${(tile * TILE + i * dx).toFixed(1)},${ys[i].toFixed(2)}`)
    }
  }
  return 'M' + pts.join(' L')
}

function Trace({ name, state }: { name: string; state: LaneState }) {
  const reduce = useReducedMotion()
  const live = state !== 'closed'
  const d = useMemo(() => tracePath(name, live), [name, live])
  const dur = useMemo(() => 4 + seeded(name)() * 3, [name])

  return (
    <div className="mdb-trace" data-trace={state}>
      <svg viewBox={`0 0 ${TILE * 2} 26`} preserveAspectRatio="none" aria-hidden="true">
        <g
          className={live && !reduce ? 'mdb-trace-run' : undefined}
          style={{ '--trace-dur': `${dur.toFixed(2)}s` } as React.CSSProperties}
        >
          <path d={d} />
        </g>
      </svg>
    </div>
  )
}


/**
 * THE INSPECTED SURFACE.
 *
 * On the field a target is one lane among many. Once you are inside it, it is
 * the only thing there is — so it gets the whole instrument: its own trace at
 * full height, its layer stack at a size you can count, and a read or write
 * pass that travels across the whole panel while the agent works.
 *
 * The state here is driven by the run, not by a timer, so the panel is showing
 * what is actually happening to the application rather than an impression of
 * activity.
 */

type Vis = 'attached' | 'inspecting' | 'writing' | 'closed'

/** How a run's stage reads on the surface being worked. */
function visualState(stage: InjectionStage | undefined, reachable: boolean): Vis {
  if (!reachable) return 'closed'
  switch (stage) {
    case 'understand':
    case 'plan':
      return 'inspecting'
    case 'inject':
    case 'verify':
      return 'writing'
    default:
      return 'attached'
  }
}

const LABEL: Record<Vis, string> = {
  attached: 'attached',
  inspecting: 'reading',
  writing: 'writing',
  closed: 'closed',
}

const TONE: Record<Vis, string> = {
  attached: 'var(--xenon-mid)',
  inspecting: 'var(--xenon)',
  writing: 'var(--filament)',
  closed: 'var(--fg-3)',
}

export function InspectedSurface({
  app, layers, stage, reachable,
}: {
  app: InstalledApp
  layers: number
  stage?: InjectionStage
  reachable: boolean
}) {
  const state = visualState(stage, reachable)
  // the lane trace only knows three states; reading rides the attached trace
  const laneState = state === 'closed' ? 'closed' : state === 'writing' ? 'writing' : 'attached'

  return (
    <div className="mdb-insp" data-state={state}>
      <div className="min-w-0 relative" style={{ zIndex: 1 }}>
        <div className="flex items-baseline gap-3 mb-1">
          <span className="mdb-display text-[17px] leading-none">{app.name}</span>
          <span className="mdb-chan">
            {app.channel === 'spicetify' ? 'spicetify' : 'cdp'}
            {app.version && app.version !== 'Unknown' ? ` · v${app.version}` : ''}
          </span>
        </div>

        <div className="mdb-insp-trace mt-2">
          <Trace name={app.name} state={laneState} />
        </div>
      </div>

      <div className="flex items-start gap-7 shrink-0 relative" style={{ zIndex: 1 }}>
        <div>
          <div className="mdb-readout-k mb-2">layers</div>
          <div className="mdb-insp-lyrs" aria-label={`${layers} layers written`}>
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`mdb-insp-lyr ${i < layers ? 'is-written' : ''}`} />
            ))}
          </div>
        </div>

        <div className="text-right">
          <div className="mdb-readout-k mb-2">state</div>
          <div className="flex items-center gap-2 justify-end">
            <span className={`mdb-dot ${reachable ? 'mdb-dot-live' : 'mdb-dot-inert'}`} />
            <span className="mdb-state" style={{ color: TONE[state] }}>{LABEL[state]}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
