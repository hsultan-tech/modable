import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, ArrowUpRight } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useAppStore } from '../stores/projectStore'
import { api } from '../api'
import { LayerEdge } from './LayerEdge'
import {
  SurfaceLayer,
  SurfacePhase,
  SurfaceTarget,
  SURFACE_STEPS,
  SURFACE_TIMING,
} from './SurfaceLayer'
import { SurfaceCallouts } from './SurfaceCallouts'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const OBJECT_SIZE = 396

/** What the machine is doing, in the interface's own voice, per step. */
const STEP_NOTE: Record<(typeof SURFACE_STEPS)[number] | 'done', string> = {
  attach: 'Taking hold of the surface',
  read: 'Reading how it is built',
  rewrite: 'Opening a seam for the new layer',
  inject: 'Setting the layer down',
  done: 'Surface modified — handing you the desk',
}

export function ApiKeyModal() {
  const { setApiKey } = useAppStore()
  const reduce = useReducedMotion() ?? false
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<SurfacePhase>('rest')
  const [hover, setHover] = useState(0)

  const [targets, setTargets] = useState<SurfaceTarget[] | null>(null)
  const [surveyFailed, setSurveyFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const connecting = phase !== 'rest'

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
          version: a.version === 'Unknown' ? 'no version' : a.version,
          realIcon: (a as { realIcon?: string }).realIcon,
          isElectron: a.isElectron,
        }))
        // reachable surfaces first — those are the ones Modable can lift
        found.sort((a, b) => Number(b.isElectron) - Number(a.isElectron))
        setTargets(found)
        if (found.length === 0) setSurveyFailed(true)
      })
      .catch(() => live && setSurveyFailed(true))
    return () => {
      live = false
    }
  }, [])

  const scene = useMemo<SurfaceTarget[]>(() => {
    if (targets && targets.length) return targets.slice(0, 3)
    if (surveyFailed)
      return [
        { name: 'surface 03', version: 'unread', isElectron: false },
        { name: 'surface 02', version: 'unread', isElectron: false },
        { name: 'surface 01', version: 'unread', isElectron: false },
      ]
    return []
  }, [targets, surveyFailed])

  const railStatus = useMemo(() => {
    if (!targets && !surveyFailed) return 'surveying this machine'
    if (surveyFailed || !targets?.length) return 'no surfaces in reach'
    const reachable = targets.filter(t => t.isElectron).length
    return `${targets.length} found · ${reachable} reachable`
  }, [targets, surveyFailed])

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
  const note = connecting ? STEP_NOTE[phase === 'done' ? 'done' : (phase as 'attach')] : null

  const onProximity = useCallback((v: number) => setHover(v), [])

  return (
    <div className="mdb h-full w-full p-5 titlebar-drag">
      <div className="mdb-stage h-full w-full flex flex-col">
        {/* ---------- the room ---------- */}
        <div className="mdb-room-wall" />
        <div className="mdb-room-floor" />
        <div className="mdb-room-horizon" />
        <div className="mdb-room-scrim" />

        {/* ---------- head rail ---------- */}
        <motion.header
          className="mdb-rail-top relative shrink-0 h-[54px] px-[var(--gut)] flex items-center justify-between"
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
          <div className="flex items-center gap-2.5">
            <span
              className={`mdb-dot ${
                phase === 'done'
                  ? 'mdb-dot-warm'
                  : connecting
                    ? 'mdb-dot-live'
                    : error
                      ? 'mdb-dot-fail'
                      : 'mdb-dot-inert'
              }`}
            />
            <span className="mdb-label" style={{ letterSpacing: '.16em' }}>
              {phase === 'done' ? 'access granted' : connecting ? phase : error ? 'key rejected' : 'no key on file'}
            </span>
          </div>
        </motion.header>

        {/* ---------- the room's one occupant, annotated ---------- */}
        <main className="relative flex-1 min-h-0">
          <div
            className="absolute hidden lg:block -translate-y-1/2"
            style={{ right: 'clamp(72px,8.4vw,132px)', top: '48%' }}
          >
            <motion.div
              className="relative"
              style={{ width: OBJECT_SIZE, height: OBJECT_SIZE }}
              initial={reduce ? false : { opacity: 0, y: 26, scale: 0.975 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.95, ease: [0.2, 0.75, 0.25, 1], delay: 0.18 }}
            >
              <motion.div
                animate={reduce || connecting ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
              >
                <SurfaceLayer
                  phase={phase}
                  size={OBJECT_SIZE}
                  targets={scene}
                  onProximity={onProximity}
                />
              </motion.div>
              <SurfaceCallouts
                size={OBJECT_SIZE}
                phase={phase}
                targets={scene}
                status={railStatus}
                hover={hover}
              />
            </motion.div>
          </div>

          {/* ---------- the invitation ---------- */}
          <div className="no-drag absolute left-[var(--gut)] top-1/2 -translate-y-1/2 w-[min(486px,46%)]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.2, 0.75, 0.25, 1] }}
          >
            <h1 className="mdb-title text-[clamp(27px,2.6vw,37px)] mb-5">
              Every app has a surface.
              <br />
              Modable lifts it.
            </h1>

            <p className="text-[13px] leading-[1.62] text-[var(--fg-1)] max-w-[382px] mb-8">
              Attach to the Electron apps already running on this machine, read how they are
              built, and write new layers onto them. Nothing restarts.
            </p>

            {/* ---------- SIGNATURE: the key intake ---------- */}
            <form onSubmit={handleSubmit} noValidate>
              <div className="mdb-intake">
                <div className="flex items-baseline justify-between mb-3">
                  <label htmlFor="mdb-key" className="mdb-label" style={{ letterSpacing: '.16em' }}>
                    OpenAI key
                  </label>
                  <span
                    className="mdb-label"
                    style={{
                      letterSpacing: '.14em',
                      color:
                        phase === 'done'
                          ? 'var(--filament)'
                          : connecting
                            ? 'var(--fg-1)'
                            : error
                              ? 'var(--fault)'
                              : plausible
                                ? 'var(--xenon-mid)'
                                : 'var(--fg-3)',
                    }}
                  >
                    {phase === 'done'
                      ? 'granted'
                      : connecting
                        ? 'in progress'
                        : error
                          ? 'rejected'
                          : plausible
                            ? 'ready'
                            : 'awaiting'}
                  </span>
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
                    {connecting ? 'Working' : 'Connect'}
                  </button>
                </div>

                {/* the four operations, printed on the panel before they run */}
                <div className="mdb-ladder mt-4">
                  {SURFACE_STEPS.map((step, i) => {
                    const done = phase === 'done' || (stepIndex > -1 && i < stepIndex)
                    const live = stepIndex === i
                    return (
                      <div key={step} className="flex items-center">
                        {i > 0 && <span className="mdb-rung-tick" />}
                        <span
                          className={`mdb-rung mdb-label ${
                            live ? 'mdb-rung-live' : done ? 'mdb-rung-done' : ''
                          }`}
                          style={{ fontSize: 9, letterSpacing: '.2em' }}
                        >
                          {step}
                          {live && (
                            <motion.span
                              className="absolute left-0 bottom-0 h-px"
                              style={{
                                background:
                                  step === 'inject' ? 'var(--filament)' : 'var(--xenon-mid)',
                                transformOrigin: '0% 50%',
                              }}
                              initial={{ scaleX: 0, width: '100%' }}
                              animate={{ scaleX: 1 }}
                              transition={{
                                duration: SURFACE_TIMING[step] / 1000,
                                ease: 'linear',
                              }}
                            />
                          )}
                          {done && (
                            <span
                              className="absolute left-0 bottom-0 h-px w-full"
                              style={{ background: 'var(--ink-4)' }}
                            />
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </form>

            {/* status and faults share one line, so nothing below ever moves */}
            <div className="h-[38px] pt-2.5">
              <AnimatePresence mode="wait">
                {error ? (
                  <motion.p
                    key={error}
                    initial={reduce ? false : { opacity: 0, x: -3 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[12px] leading-[1.4] max-w-[400px]"
                    style={{ color: 'var(--fault)' }}
                    role="alert"
                  >
                    {error}
                  </motion.p>
                ) : note ? (
                  <motion.p
                    key={phase}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[12px] text-[var(--fg-2)]"
                  >
                    {note}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          </motion.div>
          </div>
        </main>

        {/* ---------- foot rail ---------- */}
        <motion.footer
          className="mdb-rail-foot relative shrink-0 h-[56px] px-[var(--gut)] flex items-center justify-between"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.35 }}
        >
          <span className="text-[12px] text-[var(--fg-2)]">
            The key is kept on this machine and sent only to OpenAI.
          </span>
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="mdb-chip no-drag text-[12px]"
          >
            Get a key
            <ArrowUpRight size={13} strokeWidth={2} />
          </a>
        </motion.footer>
      </div>
    </div>
  )
}
