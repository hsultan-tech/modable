import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, ArrowUpRight, Check } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useAppStore, InstalledApp } from '../stores/projectStore'
import { api } from '../api'
import { LayerEdge } from './LayerEdge'
import { SurfaceTarget } from './SurfaceLayer'
import { RewriteField, FieldPhase, kindOf } from './RewriteField'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * The first run, as one title sequence: locked → authenticating → scanning →
 * surfaces found → into the product. About 2.5s end to end when discovery is
 * already in hand; scanning simply lasts as long as discovery really does.
 */
type Seq = 'locked' | 'auth' | 'scanning' | 'ready' | 'leaving'

/** ms each beat is held. Scanning is a floor, not a fixed length. */
const BEAT = {
  auth: 560,
  scanMin: 1300,
  /** time per surface as the scan resolves it, clamped by count */
  rowMin: 140,
  rowMax: 260,
  ready: 720,
  leave: 600,
} as const

/** Names the scan line will carry before it says "+n". */
const MAX_NAMES = 6

const FIELD: Record<Seq, FieldPhase> = {
  locked: 'idle',
  auth: 'auth',
  scanning: 'scanning',
  ready: 'ready',
  leaving: 'leaving',
}

const EASE = [0.2, 0.75, 0.25, 1] as const

export function ApiKeyModal() {
  const { setApiKey, setInstalledApps } = useAppStore()
  const reduce = useReducedMotion() ?? false
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seq, setSeq] = useState<Seq>('locked')
  const [revealed, setRevealed] = useState(0)

  const [targets, setTargets] = useState<SurfaceTarget[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Discovery, as a promise the sequence can wait on without re-asking. */
  const survey = useRef<Promise<SurfaceTarget[]>>()
  /** The same reading, untouched, so the home screen opens already holding it. */
  const discovered = useRef<InstalledApp[]>([])
  /** Set when the user asks to skip ahead; wakes any beat in progress. */
  const hurry = useRef<null | (() => void)>(null)
  const hurried = useRef(false)

  const connecting = seq !== 'locked'

  /**
   * The scan is a reading of this machine, so it needs a reading. `getApps`
   * wants no key, which is exactly why it can start before one is given.
   */
  useEffect(() => {
    let live = true
    survey.current = api
      .getApps()
      .then(r => {
        discovered.current = r.apps ?? []
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
        if (live) setTargets(found)
        return found
      })
      .catch(() => [] as SurfaceTarget[])
    return () => {
      live = false
    }
  }, [])

  /** Only surfaces Modable can actually lift are counted and named. */
  const surfaces = useMemo(() => (targets ?? []).filter(t => t.reachable ?? t.isElectron), [targets])
  const shown = surfaces.slice(0, Math.min(revealed, MAX_NAMES))
  const shownKey = shown.map(t => t.name).join('|')
  const kinds = useMemo(() => shown.map(t => kindOf(t.name)), [shownKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A beat of the sequence that a skip can cut short. */
  const beat = (ms: number) =>
    hurried.current
      ? Promise.resolve()
      : new Promise<void>(r => {
          const id = setTimeout(r, ms)
          hurry.current = () => {
            clearTimeout(id)
            r()
          }
        })

  /** Once access is granted, any key or click moves straight on. */
  useEffect(() => {
    if (seq !== 'scanning' && seq !== 'ready') return
    const skip = (e: Event) => {
      if (e instanceof KeyboardEvent && !['Enter', 'Escape', ' '].includes(e.key)) return
      hurried.current = true
      hurry.current?.()
    }
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [seq])

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

    // AUTHENTICATING — the ceiling lights, the app tightens under it
    setSeq('auth')
    await wait(reduce ? 160 : BEAT.auth)

    // SCANNING — the ceiling starts to lift; each real surface found pulls one
    // more piece out of the app. If discovery is still running the scan simply
    // stays open until it lands.
    setSeq('scanning')
    const began = performance.now()
    const found = ((await survey.current) ?? []).filter(t => t.reachable ?? t.isElectron)
    const steps = Math.min(found.length, MAX_NAMES)
    if (reduce || hurried.current) {
      setRevealed(steps)
    } else {
      const per = Math.max(BEAT.rowMin, Math.min(BEAT.rowMax, (BEAT.scanMin - 180) / Math.max(steps, 1)))
      await beat(180)
      for (let i = 1; i <= steps; i++) {
        setRevealed(i)
        await beat(per)
        if (hurried.current) setRevealed(steps)
      }
      const left = BEAT.scanMin - (performance.now() - began)
      if (left > 0) await beat(left)
    }

    // READY — the ceiling is all the way up: "N surfaces found"
    setSeq('ready')
    await beat(reduce ? 700 : BEAT.ready)

    // HANDOFF — the surface recedes into the product's own ground
    setSeq('leaving')
    await wait(reduce ? 220 : BEAT.leave)
    // the home screen still runs its own scan; this only spares it opening
    // on an empty room for the moment that takes
    if (discovered.current.length) setInstalledApps(discovered.current)
    setApiKey(value)
  }

  const settled = seq === 'ready' || seq === 'leaving'
  const count = surfaces.length
  const overflow = settled ? Math.max(0, count - MAX_NAMES) : 0

  const status =
    seq === 'auth'
      ? 'Verifying key'
      : seq === 'scanning'
        ? 'Scanning this machine'
        : count > 0
          ? `${count} ${count === 1 ? 'surface' : 'surfaces'} found`
          : 'No surfaces in reach yet'

  const rise = (delay: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.9, ease: EASE, delay },
        }

  return (
    <div className="mdb onb h-full w-full" data-seq={seq}>
      {/* ---------- the ceiling: one app, and the limit it is held under ---------- */}
      <RewriteField phase={FIELD[seq]} kinds={kinds} total={targets ? surfaces.length : 0} reduce={reduce} />
      <div className="onb-scrim" aria-hidden="true" />
      <div className="onb-grain" aria-hidden="true" />
      <div className="onb-drag titlebar-drag" />

      <header className="onb-mark onb-recede">
        <LayerEdge written={1} reachable slots={4} className="w-[5px] h-[15px] shrink-0" />
        <span className="mdb-label" style={{ letterSpacing: '.2em' }}>
          Modable
        </span>
      </header>

      <main className="onb-hero onb-recede">
        <motion.h1 className="onb-title" {...rise(0.25)}>
          Every app has a ceiling.
          <br />
          Modable lifts it.
        </motion.h1>
        <motion.p className="onb-sub" {...rise(0.4)}>
          Rewrite the apps already running on your machine.
        </motion.p>

        <motion.form
          onSubmit={handleSubmit}
          noValidate
          className="onb-key no-drag"
          data-seq={seq}
          {...rise(0.55)}
        >
          <div className={`mdb-slot onb-slot ${error ? 'mdb-slot-fault' : ''}`}>
            <input
              id="mdb-key"
              ref={inputRef}
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={e => {
                setKey(e.target.value)
                setError(null)
              }}
              placeholder="sk-  OpenAI key"
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
              disabled={connecting}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              type="submit"
              disabled={connecting}
              className={`mdb-pill no-drag shrink-0 ${
                seq === 'auth' ? 'is-busy' : connecting ? 'is-done' : ''
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={seq === 'locked' ? 'connect' : seq === 'auth' ? 'auth' : 'done'}
                  className="mdb-pill-face"
                  initial={reduce ? false : { opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -3 }}
                  transition={{ duration: 0.1, ease: EASE }}
                >
                  {seq === 'locked' ? (
                    'Connect'
                  ) : seq === 'auth' ? (
                    <>
                      <i className="mdb-pill-pulse" aria-hidden="true" />
                      Verifying
                    </>
                  ) : (
                    <>
                      <Check size={13} strokeWidth={2.4} aria-hidden="true" />
                      Connected
                    </>
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </motion.form>

        {/* one quiet line: the key note at rest, the status once it runs */}
        <motion.div className="onb-line" {...rise(0.7)}>
          <AnimatePresence mode="wait" initial={false}>
            {error ? (
              <motion.p
                key="error"
                className="onb-note onb-fault"
                role="alert"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {error}
              </motion.p>
            ) : !connecting ? (
              <motion.p
                key="note"
                className="onb-note"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                The key stays on this machine and is sent only to OpenAI.
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="onb-link no-drag"
                >
                  Get a key
                  <ArrowUpRight size={11} strokeWidth={2} />
                </a>
              </motion.p>
            ) : (
              <motion.div
                key="status"
                className="onb-status"
                aria-live="polite"
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <span className={`onb-state ${settled && count > 0 ? 'is-found' : ''}`}>
                  <i className="onb-dot" aria-hidden="true" />
                  {status}
                </span>
                <span className="onb-names">
                  {shown.map((t, i) => (
                    <motion.span
                      key={t.name}
                      className="onb-name"
                      initial={reduce ? false : { opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.36, ease: EASE }}
                    >
                      {i > 0 && <i className="onb-sep" aria-hidden="true" />}
                      {t.name}
                    </motion.span>
                  ))}
                  {overflow > 0 && <span className="onb-name onb-more">+{overflow}</span>}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>
    </div>
  )
}
