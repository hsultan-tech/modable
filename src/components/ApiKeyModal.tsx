import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, ArrowUpRight } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useAppStore } from '../stores/projectStore'
import { api } from '../api'
import { LayerEdge } from './LayerEdge'
import {
  SurfacePhase,
  SurfaceTarget,
  SURFACE_STEPS,
  SURFACE_TIMING,
} from './SurfaceLayer'
import { calloutRailWidth, objectOverhang } from './SurfaceCallouts'
import { AsciiSurface, SurfaceState } from './AsciiSurface'
import { SurfaceCensus, CensusState } from './SurfaceCensus'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** The onboarding sequence's phases, in the Surface's own vocabulary. */
const SURFACE_STATE: Record<SurfacePhase, SurfaceState> = {
  rest: 'idle',
  attach: 'connecting',
  read: 'inspecting',
  rewrite: 'rewriting',
  inject: 'rewriting',
  done: 'success',
}

/** What each operation does, printed on the panel before anything runs. */
const STEP_NOTE: Record<(typeof SURFACE_STEPS)[number], string> = {
  attach: 'take hold of the running surface',
  read: 'read how the window is built',
  rewrite: 'open a seam for the new layer',
  inject: 'set the layer down and let go',
}

const OBJECT_MIN = 1080

function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth))
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

export function ApiKeyModal() {
  const { setApiKey } = useAppStore()
  const reduce = useReducedMotion() ?? false
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<SurfacePhase>('rest')

  const [targets, setTargets] = useState<SurfaceTarget[] | null>(null)
  const [surveyFailed, setSurveyFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const connecting = phase !== 'rest'

  const vw = useViewportWidth()
  const showObject = vw >= OBJECT_MIN
  const size = Math.round(Math.max(292, Math.min(372, vw * 0.262)))
  const rail = useMemo(() => calloutRailWidth(size), [size])
  const overhang = useMemo(() => objectOverhang(size), [size])

  // The Surface owns its own motion and pointer response now, inside the
  // render loop — none of it needs to pass through React any more.

  /**
   * The hero is a reading of this machine, so it needs a reading. `getApps`
   * wants no key, which is exactly why it belongs on the screen that has not
   * been given one yet.
   */
  useEffect(() => {
    let live = true
    api
      .getApps()
      .then(r => {
        if (!live) return
        const found = (r.apps ?? []).map(a => ({
          name: a.name,
          version: a.version,
          realIcon: (a as { realIcon?: string }).realIcon,
          isElectron: a.isElectron,
          // The server says whether Modable can modify this app and by which
          // route. isElectron is only the answer for the CDP route — reading
          // it as the answer for everything is what listed Spotify here as
          // "no electron framework" while it was being modified successfully.
          reachable: a.reachable ?? a.isElectron,
          channel: a.channel ?? 'cdp',
        }))
        // reachable surfaces first — those are the ones Modable can lift
        found.sort((a, b) => Number(b.reachable) - Number(a.reachable))
        setTargets(found)
        if (found.length === 0) setSurveyFailed(true)
      })
      .catch(() => live && setSurveyFailed(true))
    return () => {
      live = false
    }
  }, [])

  const scene = useMemo<SurfaceTarget[]>(() => {
    if (targets && targets.length) return targets.filter(t => t.reachable ?? t.isElectron).slice(0, 3)
    if (surveyFailed)
      return [
        { name: 'surface 03', version: 'unread', isElectron: false },
        { name: 'surface 02', version: 'unread', isElectron: false },
        { name: 'surface 01', version: 'unread', isElectron: false },
      ]
    return []
  }, [targets, surveyFailed])

  const censusState: CensusState = !targets && !surveyFailed
    ? 'surveying'
    : surveyFailed || !targets?.length
      ? 'empty'
      : 'ready'

  const trimmed = key.trim()
  const plausible = trimmed.startsWith('sk-') || trimmed === 'test' || trimmed === 'demo'
  /** Four cells, filled by how much of a usable key is actually in the slot. */
  const charge = connecting
    ? 4
    : !trimmed
      ? 0
      : plausible
        ? trimmed.length >= 40
          ? 4
          : trimmed.length >= 12
            ? 3
            : 2
        : 1

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (connecting) return

    const value = key.trim()
    if (!value) {
      setError('Nothing in the slot yet. Paste a key, or type demo.')
      inputRef.current?.focus()
      return
    }
    if (!value.startsWith('sk-') && value !== 'test' && value !== 'demo') {
      setError('Keys begin with sk-. Type demo to look around without one.')
      inputRef.current?.focus()
      return
    }
    setError(null)

    if (reduce) return setApiKey(value)

    // the injection sequence in miniature: take hold, read the surface, open
    // it, set the new layer, hand it over
    for (const step of SURFACE_STEPS) {
      setPhase(step)
      await wait(SURFACE_TIMING[step])
    }
    setPhase('done')
    await wait(SURFACE_TIMING.done)
    setApiKey(value)
  }

  const stepIndex = SURFACE_STEPS.indexOf(phase as (typeof SURFACE_STEPS)[number])

  return (
    <div className="mdb mdb-onb h-full w-full p-5 titlebar-drag">
      <div className="mdb-stage h-full w-full flex flex-col">
        {/* ---------- the room ---------- */}
        <div className="mdb-room-wall" />
        <div className="mdb-room-floor" />
        <div className="mdb-room-horizon" />
        <div className="mdb-room-scrim" />

        {/* ---------- head rail ---------- */}
        <motion.header
          className="mdb-rail-top"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <div className="flex items-center gap-2.5">
            <LayerEdge written={1} reachable slots={4} className="w-[5px] h-[15px] shrink-0" />
            <span className="mdb-label" style={{ letterSpacing: '.2em' }}>
              Modable
            </span>
          </div>
          {/* the rail speaks only when there is something to say — at rest the
              whole screen already means "no key on file" */}
          <AnimatePresence>
            {(connecting || error) && (
              <motion.div
                className="flex items-center gap-2.5"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span
                  className={`mdb-dot ${
                    phase === 'done' ? 'mdb-dot-warm' : connecting ? 'mdb-dot-live' : 'mdb-dot-fail'
                  }`}
                />
                <span className="mdb-label" style={{ letterSpacing: '.16em' }}>
                  {phase === 'done' ? 'access granted' : connecting ? phase : 'key rejected'}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.header>

        <main className="mdb-body">
          {/* ---------- the working column ---------- */}
          <motion.div
            className="mdb-col no-drag"
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.2, 0.75, 0.25, 1] }}
          >
            <div>
              <h1 className="mdb-title mdb-lede">
                Every app has a surface.
                <br />
                Modable lifts it.
              </h1>
              <p className="mdb-sub">
                Read the applications already on this machine, see how they are built, and write
                new layers onto them.
              </p>
            </div>

            {/* ---------- SIGNATURE: the key intake ---------- */}
            <form onSubmit={handleSubmit} noValidate className="mdb-intake">
              <div className="mdb-intake-head">
                <label htmlFor="mdb-key" className="mdb-label" style={{ letterSpacing: '.16em' }}>
                  OpenAI key
                </label>
              </div>

              <div className={`mdb-slot ${error ? 'mdb-slot-fault' : ''}`}>
                <span className="mdb-gauge" aria-hidden="true">
                  {[0, 1, 2, 3].map(i => (
                    <i
                      key={i}
                      className={
                        i < charge
                          ? phase === 'done'
                            ? 'hot'
                            : charge === 4
                              ? 'full'
                              : 'on'
                          : ''
                      }
                    />
                  ))}
                </span>

                <input
                  id="mdb-key"
                  ref={inputRef}
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={e => {
                    setKey(e.target.value)
                    setError(null)
                  }}
                  placeholder="sk-"
                  disabled={connecting}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="OpenAI API key"
                  aria-invalid={!!error}
                  className="mdb-key-input no-drag"
                />

                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="mdb-ghost no-drag shrink-0"
                  aria-label={showKey ? 'Hide key' : 'Show key'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button type="submit" disabled={connecting} className="mdb-pill no-drag shrink-0">
                  {phase === 'done' ? 'Granted' : connecting ? 'Working' : 'Connect'}
                </button>
              </div>

              {/* one line, so nothing below it ever moves */}
              <div className="mdb-say">
                <AnimatePresence mode="wait">
                  {error ? (
                    <motion.p
                      key={error}
                      initial={reduce ? false : { opacity: 0, x: -3 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className="mdb-say-fault"
                      role="alert"
                    >
                      {error}
                    </motion.p>
                  ) : phase === 'done' ? (
                    <motion.p
                      key="done"
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="mdb-say-ok"
                    >
                      Surface modified — handing you the desk.
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </div>

              {/* At rest the four operations are one quiet line — naming what
                  will happen without explaining it four times over. The full
                  ladder only unfolds once something is actually running. */}
              {!connecting ? (
                <p className="mdb-ladder-rest mdb-label">{SURFACE_STEPS.join('  ·  ')}</p>
              ) : (
              <ol className="mdb-ladder">
                {SURFACE_STEPS.map((step, i) => {
                  const done = phase === 'done' || (stepIndex > -1 && i < stepIndex)
                  const live = stepIndex === i
                  return (
                    <li
                      key={step}
                      className={`mdb-rung ${live ? 'is-live' : done ? 'is-done' : ''}`}
                    >
                      <span className="mdb-rung-no">{String(i + 1).padStart(2, '0')}</span>
                      <span className="mdb-rung-name">
                        {step}
                        {live && (
                          <motion.span
                            className="mdb-rung-draw"
                            style={{
                              background:
                                step === 'inject' ? 'var(--filament)' : 'var(--xenon-mid)',
                            }}
                            initial={{ scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{
                              duration: SURFACE_TIMING[step] / 1000,
                              ease: 'linear',
                            }}
                          />
                        )}
                        {done && <span className="mdb-rung-struck" />}
                      </span>
                      <span className="mdb-rung-note">{STEP_NOTE[step]}</span>
                    </li>
                  )
                })}
              </ol>
              )}
            </form>

            <SurfaceCensus
              apps={targets ?? []}
              onStage={scene.map(s => s.name)}
              state={censusState}
              phase={phase}
            />
          </motion.div>

          {/* ---------- the room's one occupant, annotated ---------- */}
          {showObject && (
            <motion.div
              className="mdb-specimen"
              style={
                {
                  width: rail + size + overhang,
                  height: size,
                  '--sl-overhang': `${overhang}px`,
                } as React.CSSProperties
              }
              initial={reduce ? false : { opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.2, 0.75, 0.25, 1], delay: 0.16 }}
            >
              {/* The hero is a real solid now — lit, turning in perspective,
                  drawn to a character grid — not planes under CSS transforms.
                  The callout leaders came off with it: they were ruled against
                  the old rig's projection maths and mean nothing here. */}
              <AsciiSurface state={SURFACE_STATE[phase]} fontSize={6.6} />
            </motion.div>
          )}
        </main>

        {/* ---------- foot rail ---------- */}
        <motion.footer
          className="mdb-rail-foot"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.35 }}
        >
          <span className="mdb-foot-note">
            The key is kept on this machine and sent only to OpenAI.
          </span>
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="mdb-chip no-drag"
          >
            Get a key
            <ArrowUpRight size={13} strokeWidth={2} />
          </a>
        </motion.footer>
      </div>
    </div>
  )
}
