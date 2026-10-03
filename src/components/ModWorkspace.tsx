import { useState, useEffect, useRef } from 'react'
import { Loader2, ArrowLeft } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useAppStore, InjectionStage, InjectionRun } from '../stores/projectStore'
import { useModAgent } from '../agent/useModAgent'
import { usesSpicetify, importMessageForDrop } from '../agent/routing'
import { api, SpicetifyStatus } from '../api'
import { CommandPalette, useCommandPalette, CommandAction } from './CommandPalette'
import { ApiKeyChangeModal } from './ProfileMenu'
import { DashboardSidebar } from './DashboardSidebar'
import { type MarkState } from './SurfaceMark'
import { SurfaceField } from './SurfaceField'
import { suggestionsFor } from '../agent/suggestions'
import { CodeBuffer, BufferState } from './CodeBuffer'

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

const clock = (t: number) =>
  new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

/** A layer's name as a filename for the buffer's tab. */
const slug = (name: string, kind: 'css' | 'js' = 'js') =>
  (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layer') +
  (kind === 'css' ? '.css' : '.js')

/** A generated layer: what it is called, what it does, the code itself, the
 *  window it was written against, and the marks it claims to leave behind. */
type Layer = {
  name: string
  description: string
  code: string
  targetId?: string
  marks?: string[]
  /** cdp for everything evaluated into a live window; spicetify for Spotify,
   *  which is patched on disk instead. Defaults to cdp when absent. */
  channel?: 'cdp' | 'spicetify'
  /** spicetify only: stylesheet or extension. */
  kind?: 'css' | 'js'
}


export function ModWorkspace({ onNavigateToHistory }: { onNavigateToHistory?: () => void }) {
  const {
    selectedApp, setSelectedApp, messages, isAgentWorking, currentAction,
    isAppLaunched, setAppLaunched, isDebuggerReady, setDebuggerReady, setApiKey,
    injectionHistory, injectionRun, draftCode, installedApps,
  } = useAppStore()
  const { generateMod } = useModAgent()
  const [input, setInput] = useState('')
  const [isLaunching, setIsLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const commandPalette = useCommandPalette()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const reduce = useReducedMotion()
  const [pinned, setPinned] = useState<{ name: string; code: string; kind?: 'css' | 'js'; written?: number } | null>(null)
  const [bufferClosed, setBufferClosed] = useState(false)
  /** The layer drawer lists this app's layers only when opened from the status line. */
  const [showLayers, setShowLayers] = useState(false)
  const focusRef = useRef<HTMLDivElement>(null)

  const layers = (injectionHistory || []).filter(r => r.success && r.appName === selectedApp?.name)

  /* The surface shows what the run is doing, driven by the real stage. */
  const markState: MarkState =
    injectionRun?.stage === 'fault' ? 'fault'
      : injectionRun?.stage === 'understand' ? 'inspecting'
        : injectionRun?.stage === 'plan' ? 'inspecting'
          : injectionRun?.stage === 'inject' ? 'writing'
            : injectionRun?.stage === 'verify' ? 'verifying'
              : 'idle'
  const transcript = messages.filter(m => m.role !== 'system')

  /* Spotify is ready for a different reason than everything else. There is no
     debugger to attach to, so "can we modify this" is answered by whether
     Spicetify is installed and pointed at a patchable Spotify — which is a
     question about this machine, not about a running process. */
  const viaSpicetify = usesSpicetify(selectedApp?.name)
  const [spicetify, setSpicetify] = useState<SpicetifyStatus | null>(null)

  useEffect(() => {
    if (!viaSpicetify) { setSpicetify(null); return }
    let live = true
    api.spicetifyStatus()
      .then(s => { if (live) setSpicetify(s) })
      .catch(() => { if (live) setSpicetify(null) })
    return () => { live = false }
    // Re-read after anything is applied, so the revert command below appears
    // (and its count is right) without needing a reload.
  }, [viaSpicetify, selectedApp?.name, injectionHistory.length])

  const spicetifyReady = !!spicetify?.installed && !!spicetify?.spotifyFound && !spicetify?.appStoreBuild
  const ready = viaSpicetify ? spicetifyReady : isDebuggerReady
  const suggestions = suggestionsFor(viaSpicetify ? 'spicetify' : 'cdp')
  const appliedMods = spicetify?.mods || []

  const [reverting, setReverting] = useState(false)
  const [revertNote, setRevertNote] = useState<string | null>(null)

  /**
   * Take every Modable modification back off Spotify.
   *
   * Deliberately all-or-nothing and deliberately narrow: the server removes
   * only files carrying Modable's own prefix, so the user's theme, Marketplace
   * and their own extensions cannot be caught by it. The counts it reports back
   * are what makes that checkable rather than merely promised.
   */
  const handleRevertAll = async () => {
    if (reverting) return
    setReverting(true)
    setRevertNote(null)
    try {
      const result = await api.spicetifyRevert()
      const fresh = await api.spicetifyStatus()
      setSpicetify(fresh)

      if (!result.success) {
        setRevertNote(result.error || 'Some modifications could not be removed.')
      } else if (!result.reverted) {
        setRevertNote(result.note || 'Modable had nothing applied to Spotify.')
      } else {
        setRevertNote(
          `Removed ${result.removed?.length ?? 0} modification` +
          `${result.removed?.length === 1 ? '' : 's'}. Your theme (${result.theme || 'none'}) ` +
          `and ${result.userExtensions?.length ?? 0} of your own extensions were left alone. ` +
          `Restart Spotify to drop them.`,
        )
      }
    } catch (err) {
      setRevertNote(err instanceof Error ? err.message : 'The revert failed.')
    } finally {
      setReverting(false)
    }
  }

  useEffect(() => {
    // Polling for a debug port is meaningless for Spotify — it never opens one.
    if (viaSpicetify) return
    const checkDebugger = async () => {
      try {
        const status = await api.isDebuggerReady()
        if (status.ready && status.pageCount > 0) {
          setAppLaunched(true)
          setDebuggerReady(true)
          setLaunchError(null)
        }
      } catch {
        // debugger not reachable yet
      }
    }
    checkDebugger()
    const interval = setInterval(checkDebugger, 1000)
    return () => clearInterval(interval)
  }, [viaSpicetify, setAppLaunched, setDebuggerReady])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [transcript.length, isAgentWorking])

  // A buffer closed by hand should not stay shut over the next layer being
  // written — that would look like the code stopped streaming.
  useEffect(() => {
    if (isAgentWorking) setBufferClosed(false)
  }, [isAgentWorking])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isAgentWorking || !selectedApp) return
    const msg = input.trim()
    setInput('')
    setPinned(null)
    await generateMod(msg)
  }

  /* A request typed in the workspace composer before this view existed. It is
     consumed once and cleared, so re-entering the surface never replays it. */
  const pendingPrompt = useAppStore(st => st.pendingPrompt)
  const setPendingPrompt = useAppStore(st => st.setPendingPrompt)
  const claimed = useRef(false)

  useEffect(() => {
    if (!pendingPrompt || claimed.current || !selectedApp || !ready) return
    claimed.current = true
    setPendingPrompt(null)
    setPinned(null)
    void generateMod(pendingPrompt)
  }, [pendingPrompt, selectedApp, ready])

  const runCommand = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  /* ⌥1–⌥3 put a suggestion at the prompt, the same as clicking it. Matched on
     e.code because on macOS Option+1 types '¡' and e.key never says '1'. */
  const shortcutsLive = ready && !transcript.length && !isAgentWorking
  useEffect(() => {
    if (!shortcutsLive) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return
      const n = /^Digit([1-9])$/.exec(e.code)?.[1]
      const cmd = n && suggestions[Number(n) - 1]
      if (!cmd) return
      e.preventDefault()
      runCommand(cmd)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcutsLive, suggestions])

  const handleLaunch = async () => {
    if (!selectedApp) return
    setIsLaunching(true)
    setLaunchError(null)

    /* Spotify is never launched with a debug port — it would ignore the flag,
       and killing the user's running Spotify to pass it would be destructive
       for nothing. "Starting" here means re-reading whether Spicetify can
       actually reach it. */
    if (viaSpicetify) {
      try {
        const status = await api.spicetifyStatus()
        setSpicetify(status)
        if (!status.installed) {
          setLaunchError(status.reason || 'Spicetify is not available on this machine.')
        } else if (!status.spotifyFound) {
          setLaunchError(`No Spotify found at ${status.spotifyPath}.`)
        } else if (status.appStoreBuild) {
          setLaunchError(
            'This is the App Store build of Spotify, which is sandboxed and cannot be ' +
            'patched. Install the desktop build from spotify.com.',
          )
        } else {
          setAppLaunched(true)
        }
      } catch (err) {
        setLaunchError(err instanceof Error ? err.message : 'Could not read the Spicetify setup.')
      } finally {
        setIsLaunching(false)
      }
      return
    }

    try {
      const result = await api.launchWithDebugger(selectedApp.path)
      if (result.success) {
        setAppLaunched(true)
        setDebuggerReady(true)
        setLaunchError(null)
      } else {
        setLaunchError(result.error || 'The application did not start with a debugger port open')
      }
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : 'The application did not start')
    } finally {
      setIsLaunching(false)
    }
  }

  const handleRefreshStatus = async () => {
    try {
      const status = await api.isDebuggerReady()
      if (status.ready && status.pageCount > 0) {
        setAppLaunched(true)
        setDebuggerReady(true)
        setLaunchError(null)
      }
    } catch (err) {
      console.error('Failed to check debugger status:', err)
    }
  }

  const handleLogout = () => setApiKey(null)
  const handleHome = () => setSelectedApp(null)

  const handleCommand = (action: CommandAction) => {
    switch (action.type) {
      case 'view-history': onNavigateToHistory?.(); break
      case 'change-api-key': setShowApiKeyModal(true); break
      case 'logout': handleLogout(); break
      case 'select-app': {
        // switching surfaces from the palette: the field morphs to the new app
        const next = installedApps.find(a => a.name === action.appName)
        if (next) setSelectedApp(next)
        break
      }
    }
  }

  if (!selectedApp) return null

  /* The buffer shows, in priority order: what the model is writing right now,
     whatever layer was opened by hand, the last layer drafted this session,
     then the most recent one already written to this app. */
  const lastDraft = [...transcript].reverse().find(m => m.modPreview)?.modPreview
  const lastWritten = layers[0]

  /* The buffer is not permanent furniture. It opens when the agent starts
     working, or when a layer is opened by hand, and stays closed otherwise so
     the splash keeps the middle of the pane to itself. */
  /* "show code" used to be a no-op for the layer that had just been written:
     the buffer was already showing it via lastDraft, so pinning the same code
     changed nothing on screen and the command read as broken. It is a toggle
     now, which means the panel needs to be closable by hand. */
  const bufferOpen = !bufferClosed && (isAgentWorking || !!pinned || !!lastDraft)

  let buffer: { code: string; title: string; state: BufferState; subtitle?: string }
  if (isAgentWorking) {
    buffer = { code: draftCode, title: 'layer.js', state: 'drafting' }
  } else if (pinned) {
    buffer = {
      code: pinned.code,
      title: slug(pinned.name, pinned.kind),
      state: pinned.written ? 'written' : 'ready',
      subtitle: pinned.written ? 'written ' + clock(pinned.written) : undefined,
    }
  } else if (lastDraft) {
    buffer = { code: lastDraft.code, title: slug(lastDraft.name, lastDraft.kind), state: 'ready' }
  } else if (lastWritten) {
    buffer = {
      code: lastWritten.code,
      title: slug(lastWritten.modName),
      state: 'written',
      subtitle: 'written ' + clock(lastWritten.timestamp),
    }
  } else {
    buffer = { code: '', title: 'layer.js', state: 'empty' }
  }

  const closeBuffer = () => { setPinned(null); setBufferClosed(true); setShowLayers(false) }

  /* One status line, the home screen's own: state · mechanism · version ·
     layers. Every word is real data; nothing here is decoration. */
  const stateWord = viaSpicetify
    ? ready ? 'Ready' : 'Not ready'
    : ready ? 'Attached' : isAppLaunched ? 'Running' : 'Not started'
  const layerWord = layers.length
    ? `${layers.length} ${layers.length === 1 ? 'layer' : 'layers'}`
    : 'No layers'

  const openLayers = () => {
    if (!layers.length) return
    if (showLayers && bufferOpen) return closeBuffer()
    const latest = layers[0]
    setBufferClosed(false)
    setShowLayers(true)
    setPinned({ name: latest.modName, code: latest.code, written: latest.timestamp })
  }

  const arrive = (i: number) => reduce
    ? { initial: false as const }
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { delay: 0.3 + i * 0.07, duration: 0.5, ease: [0.2, 0.7, 0.3, 1] as [number, number, number, number] },
      }

  return (
    <div className="mdb h-full w-full flex overflow-hidden">
      {/* the home screen's floating dock, not a full-height rail */}
      <DashboardSidebar
        compact
        activeView="dashboard"
        onLogout={handleLogout}
        onRefresh={handleHome}
        onHistory={onNavigateToHistory}
        onOpenCommandPalette={commandPalette.open}
        onSettings={() => setShowApiKeyModal(true)}
      />

      <main className="ws">
        {/* the living surface bleeds behind everything; only the form is placed */}
        <SurfaceField
          src={selectedApp.realIcon}
          emoji={selectedApp.icon}
          state={markState}
          variant="workspace"
          focusRef={focusRef}
          className="ws-field"
        />

        <div className="titlebar-drag ws-drag" />

        <div className="ws-head">
          <nav className="ws-crumb no-drag" aria-label="Location">
            <button type="button" onClick={handleHome}>
              <ArrowLeft size={13} strokeWidth={1.8} aria-hidden />
              Surfaces
            </button>
          </nav>
        </div>

        <div className="ws-axis">
          {/* ---------- identity beside the surface, on the composer's width ---------- */}
          <div className="ws-top">
            <motion.header className="ws-id" {...arrive(0)}>
              <h1 className="ws-name">{selectedApp.name}</h1>
              <p className="hs-meta ws-meta">
                <span className={`hs-state ${ready ? 'is-live' : ''}`}>{stateWord}</span>
                <span className="hs-sep" aria-hidden>·</span>
                <span className="hs-mech">{viaSpicetify ? 'SPICETIFY' : 'CDP'}</span>
                {selectedApp.version && (
                  <><span className="hs-sep" aria-hidden>·</span><span className="hs-ver">{selectedApp.version}</span></>
                )}
                <span className="hs-sep" aria-hidden>·</span>
                {layers.length ? (
                  <button
                    type="button"
                    className="hs-layers ws-layers"
                    onClick={openLayers}
                    aria-expanded={showLayers && bufferOpen}
                    title="Show the layers written to this app"
                  >
                    {layerWord}
                  </button>
                ) : (
                  <span className="hs-ver">{layerWord}</span>
                )}
              </p>

              {/* only what needs a decision appears here, and only while it does */}
              {(!ready || (viaSpicetify && !!spicetify?.needsBackup) || (viaSpicetify && !!appliedMods.length) || revertNote || launchError) && (
                <div className="ws-act">
                  {viaSpicetify && ready && spicetify?.needsBackup && (
                    <p className="ws-note">Spotify updated since Spicetify last patched it. The next write re-patches it first.</p>
                  )}
                  {!ready && (
                    <button onClick={handleLaunch} disabled={isLaunching} className="ws-primary">
                      {isLaunching
                        ? (viaSpicetify ? 'Checking…' : 'Starting…')
                        : (viaSpicetify ? 'Check Spicetify' : 'Start with Modable')}
                    </button>
                  )}
                  {/* A Spicetify modification is a file on disk that survives every
                      restart, so the way to take it back off sits beside the state
                      it describes whenever Modable has anything applied. */}
                  {viaSpicetify && !!appliedMods.length && (
                    <button
                      onClick={handleRevertAll}
                      disabled={reverting}
                      className="ws-link"
                      title="Remove only the modifications Modable applied, leaving your theme and extensions alone"
                    >
                      {reverting ? 'Removing…' : `Remove Modable's changes (${appliedMods.length})`}
                    </button>
                  )}
                  {revertNote && <p className="ws-note">{revertNote}</p>}
                  {launchError && (
                    <div className="ws-error" role="alert">
                      <p>{launchError}</p>
                      {launchError.includes('ECONNREFUSED') && (
                        <p className="ws-note">If the application showed a crash dialog, choose Ignore, then check again.</p>
                      )}
                      <button onClick={handleRefreshStatus} className="ws-link">Check again</button>
                    </div>
                  )}
                </div>
              )}
            </motion.header>

            {/* the working surface: medium-large, fully in view, right of the identity */}
            <div ref={focusRef} className="ws-focus" aria-hidden="true" />
          </div>

          {/* ---------- session + prompt, anchored at the foot ---------- */}

          {/* ---------- the session, once there is one ---------- */}
          {transcript.length > 0 && (
            <div ref={scrollRef} className="ws-log mdb-term">
              <div className="space-y-4">
                {transcript.map(msg => (
                  <motion.div
                    key={msg.id}
                    initial={reduce ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22 }}
                  >
                    {msg.role === 'user' ? (
                      <div className="flex items-baseline gap-3">
                        <span className="mdb-prompt">›</span>
                        <span style={{ color: 'var(--fg-0)' }}>{msg.content}</span>
                      </div>
                    ) : (
                      <div className="mdb-out">
                        <p className="whitespace-pre-wrap">{msg.content.replace(/\*\*/g, '')}</p>
                        {msg.modPreview && (
                          <ModPreview
                            mod={msg.modPreview}
                            canInject={ready}
                            showing={bufferOpen && !isAgentWorking && buffer.code === msg.modPreview.code}
                            onOpen={() => {
                              const onScreen =
                                bufferOpen && !isAgentWorking && buffer.code === msg.modPreview!.code
                              if (onScreen) return closeBuffer()
                              setBufferClosed(false)
                              setShowLayers(false)
                              setPinned({
                                name: msg.modPreview!.name,
                                code: msg.modPreview!.code,
                                kind: msg.modPreview!.kind,
                              })
                            }}
                          />
                        )}
                      </div>
                    )}
                  </motion.div>
                ))}

                {injectionRun && injectionRun.stage !== 'idle'
                  ? <InjectionLine run={injectionRun} />
                  : isAgentWorking && currentAction && <Working label={currentAction.description} />}
              </div>
            </div>
          )}

          {/* ---------- suggestions, then the prompt ---------- */}
          <div className="ws-dock">
            {!transcript.length && (
              <motion.div className="ws-suggest" {...arrive(1)}>
                {suggestions.map((cmd, i) => (
                  <button
                    key={cmd}
                    onClick={() => runCommand(cmd)}
                    disabled={!ready}
                    aria-keyshortcuts={`Alt+${i + 1}`}
                    title={
                      ready
                        ? `Put this at the prompt (⌥${i + 1})`
                        : viaSpicetify ? 'Spicetify is not ready on this machine' : 'Start the application first'
                    }
                  >
                    <kbd aria-hidden="true">⌥{i + 1}</kbd>
                    <span>{cmd}</span>
                  </button>
                ))}
              </motion.div>
            )}

            <motion.form
              onSubmit={handleSubmit}
              className="ws-composer no-drag"
              data-disabled={!ready || undefined}
              data-armed={(ready && !!input.trim() && !isAgentWorking) || undefined}
              data-working={isAgentWorking || undefined}
              {...arrive(2)}
            >
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                aria-label={`Describe a change to ${selectedApp.name}`}
                onChange={e => {
                  setInput(e.target.value)
                  // grow with the text, then scroll
                  const el = e.target
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
                }}
                onKeyDown={e => {
                  // Enter sends, Shift+Enter breaks the line
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit(e as unknown as React.FormEvent)
                  }
                }}
                /* Dropping an MP3 here is how a file reaches Modable: there is no
                   file picker, and Electron's own default for a dropped file is to
                   navigate the window to it, which throws the app away. Both
                   handlers preventDefault for that reason, not out of habit. */
                onDragOver={e => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={e => {
                  e.preventDefault()
                  const dropped = e.dataTransfer.files?.[0]
                  if (!dropped) return
                  const message = importMessageForDrop(dropped as unknown as { name: string; path: string })
                  setInput(
                    message ??
                      `${dropped.name} is not an MP3, so Modable cannot import it into Spotify.`
                  )
                  inputRef.current?.focus()
                }}
                placeholder={
                  ready
                    ? `Describe a change to ${selectedApp.name}`
                    : viaSpicetify
                      ? 'Spicetify is not ready on this machine'
                      : 'Start the application first'
                }
                disabled={isAgentWorking || !ready}
                className="ws-area"
              />

              <div className="ws-foot">
                {/* the prompt is always addressed to one app, and says which */}
                <span className="ws-target">
                  <span className="ws-target-i" aria-hidden>
                    {selectedApp.realIcon ? <img src={selectedApp.realIcon} alt="" draggable={false} /> : selectedApp.icon}
                  </span>
                  <span className="ws-target-n">{selectedApp.name}</span>
                  <span className="ws-target-c">{viaSpicetify ? 'SPICETIFY' : 'CDP'}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="ws-hint"><kbd>&#8679;&#8629;</kbd> new line</span>
                  <button
                    type="submit"
                    disabled={isAgentWorking || !ready || !input.trim()}
                    className="ws-send"
                    data-working={isAgentWorking || undefined}
                  >
                    {isAgentWorking && <Loader2 size={13} className="animate-spin" />}
                    {isAgentWorking ? 'Writing' : 'Write layer'}
                    {!isAgentWorking && <kbd aria-hidden="true">&#8629;</kbd>}
                  </button>
                </span>
              </div>
            </motion.form>
          </div>
        </div>
      </main>

      {/* ---------- the layer drawer: only when there is a layer to look at ---------- */}
      <AnimatePresence initial={false}>
        {bufferOpen && (
          <motion.aside
            key="buffer"
            className="ws-drawer-lane hidden lg:block"
            initial={reduce ? false : { width: 0, opacity: 0 }}
            animate={{ width: 424, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { width: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.2, 0.7, 0.3, 1] }}
          >
            <div className="ws-drawer">
              {showLayers && layers.length > 0 && !isAgentWorking && (
                <ol className="ws-layer-list" aria-label={`Layers on ${selectedApp.name}`}>
                  {layers.slice(0, 6).map(record => {
                    const on = pinned?.code === record.code && pinned?.written === record.timestamp
                    return (
                      <li key={record.id}>
                        <button
                          type="button"
                          data-on={on || undefined}
                          onClick={() => setPinned({ name: record.modName, code: record.code, written: record.timestamp })}
                        >
                          <span className="ws-layer-n">{record.modName}</span>
                          <span className="ws-layer-t">{clock(record.timestamp)}</span>
                        </button>
                      </li>
                    )
                  })}
                  {layers.length > 6 && onNavigateToHistory && (
                    <li>
                      <button type="button" className="ws-layer-more" onClick={onNavigateToHistory}>
                        All {layers.length} in history
                      </button>
                    </li>
                  )}
                </ol>
              )}
              <div className="flex-1 min-h-0">
                <CodeBuffer {...buffer} onClose={isAgentWorking ? undefined : closeBuffer} />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <CommandPalette isOpen={commandPalette.isOpen} onClose={commandPalette.close} onCommand={handleCommand} />
      <ApiKeyChangeModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />
    </div>
  )
}

const SPIN = ['|', '/', '-', '\\']

/** What each stage of a run is actually doing, in the interface's own voice. */
const STAGE_LABEL: Partial<Record<InjectionStage, string>> = {
  understand: 'reading the surface',
  plan: 'planning the layer',
  inject: 'writing the layer into the application',
  verify: 'verifying the layer took',
  done: 'layer written',
  fault: 'the layer did not take',
}

/**
 * A run, on one line.
 *
 * This replaces the full-screen injection overlay. The code buffer beside it
 * already shows the work streaming, so covering the workspace to re-state it
 * in a ladder was spending the whole screen on something the user could
 * already see. Stage, elapsed, and — when it matters — why it failed.
 */
function InjectionLine({ run }: { run: InjectionRun }) {
  const reduce = useReducedMotion()
  const [frame, setFrame] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const started = useRef(Date.now())
  const settled = run.stage === 'done' || run.stage === 'fault'

  useEffect(() => {
    started.current = Date.now()
    setElapsed(0)
  }, [run.modName])

  useEffect(() => {
    if (settled) return
    const t = setInterval(() => setElapsed(Date.now() - started.current), 100)
    return () => clearInterval(t)
  }, [settled])

  useEffect(() => {
    if (reduce || settled) return
    const t = setInterval(() => setFrame(f => (f + 1) % SPIN.length), 110)
    return () => clearInterval(t)
  }, [reduce, settled])

  /* Cold while reading, warm while writing, fault red when it did not take —
     the same rule the rest of the surface language uses. */
  const writing = run.stage === 'inject' || run.stage === 'verify' || run.stage === 'done'
  const accent =
    run.stage === 'fault' ? 'var(--fault)' : writing ? 'var(--filament)' : 'var(--xenon-mid)'

  const glyph = run.stage === 'fault' ? '\u00d7' : run.stage === 'done' ? '\u00b7' : reduce ? '\u00b7' : SPIN[frame]

  return (
    <div className="flex items-baseline gap-3">
      <span style={{ color: accent }}>{glyph}</span>
      <span style={{ color: 'var(--fg-2)' }}>
        {run.error || STAGE_LABEL[run.stage] || ''}
      </span>
      <span className="ml-auto tabular-nums" style={{ color: 'var(--fg-3)' }}>
        {(elapsed / 1000).toFixed(1)}s
      </span>
    </div>
  )
}

function Working({ label }: { label: string }) {
  const reduce = useReducedMotion()
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setFrame(f => (f + 1) % SPIN.length), 110)
    return () => clearInterval(t)
  }, [reduce])
  return (
    <div className="flex items-baseline gap-3">
      <span style={{ color: 'var(--xenon-mid)' }}>{reduce ? '·' : SPIN[frame]}</span>
      <span style={{ color: 'var(--fg-2)' }}>{label.replace(/\.\.\.$/, '')}</span>
    </div>
  )
}

/**
 * The proposed layer, and the command that writes it.
 *
 * Running it drives the Surface Injection sequence. Each stage waits on the real
 * work behind it — reading the debugger, sending the code — with a floor on how
 * briefly a stage may show, so the sequence stays legible.
 */
function ModPreview({ mod, canInject, showing, onOpen }: {
  mod: {
    name: string; description: string; code: string
    targetId?: string; marks?: string[]
    channel?: 'cdp' | 'spicetify'; kind?: 'css' | 'js'
  }
  canInject: boolean
  /** Whether the buffer is currently displaying this modification's code. */
  showing?: boolean
  onOpen: () => void
}) {
  const { selectedApp, addInjection, setInjectionRun, injectionHistory } = useAppStore()
  const { repairLayer } = useModAgent()
  const [injected, setInjected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Spicetify only: what the user still has to do for it to show up. */
  const [hint, setHint] = useState<string | null>(null)

  const layersBefore = (injectionHistory || []).filter(
    r => r.success && r.appName === selectedApp?.name
  ).length

  const handleInject = async () => {
    if (busy) return
    setBusy(true)
    setError(null)

    // The layer being written. A repair replaces it, so everything below —
    // the overlay's title, what gets recorded — follows the rewrite.
    let layer: Layer = {
      name: mod.name, description: mod.description, code: mod.code,
      targetId: mod.targetId, marks: mod.marks,
    }

    const stage = (s: InjectionStage, extra?: Partial<{ error: string | null }>) =>
      setInjectionRun({ stage: s, modName: layer.name, layersBefore, ...extra })

    const record = (success: boolean, extra?: { channel?: 'cdp' | 'spicetify'; slug?: string }) => {
      if (!selectedApp) return
      addInjection({
        appName: selectedApp.name,
        modName: layer.name,
        description: layer.description,
        success,
        code: layer.code,
        ...extra,
      })
    }

    /**
     * Spotify's write.
     *
     * Nothing below this point applies to it. There is no window to pin, no
     * marks to compare before and after, and no repair worth attempting — the
     * file either got written and applied or it did not, and the CLI says
     * which. Failure here is reported with the CLI's own output rather than a
     * paraphrase, because the reasons an apply fails (Spotify updated itself,
     * the backup is stale) are only ever legible in its words.
     *
     * It also never calls revertLayer: that evaluates a removal script into a
     * live window, which Spotify does not have.
     */
    if (mod.channel === 'spicetify') {
      try {
        stage('understand')
        await delay(4800)
        stage('plan')
        await delay(1400)
        stage('inject')

        const [result] = await Promise.all([
          api.spicetifyApply({
            name: layer.name,
            description: layer.description,
            kind: mod.kind || 'js',
            code: layer.code,
          }),
          // The write is the shortest beat in the sequence, not the longest —
          // a snap between two calm stages. The real call sets the ceiling;
          // this only sets the floor.
          delay(520),
        ])

        if (!result.success) {
          stage('fault', { error: result.error || 'The modification could not be applied' })
          setError(
            [result.error, result.command && `(${result.command})`, result.output]
              .filter(Boolean)
              .join('\n'),
          )
          record(false, { channel: 'spicetify', slug: result.slug })
          await delay(1700)
          return
        }

        stage('verify')
        await delay(620)

        if (!result.verified) {
          stage('fault', { error: 'Applied, but Spicetify does not list the modification' })
          setError(result.note || 'Applied, but Spicetify does not list the modification.')
          record(false, { channel: 'spicetify', slug: result.slug })
          await delay(1700)
          return
        }

        stage('done')
        record(true, { channel: 'spicetify', slug: result.slug })
        setInjected(true)
        // The one thing the CDP path never has to say: this does not take
        // effect in a client that is already running. And if Modable had to
        // re-patch Spotify to get here, that is not something to do silently.
        setHint(
          [result.repairedBackup, result.note || 'Restart Spotify to load the modification.']
            .filter(Boolean)
            .join(' '),
        )
        await delay(1150)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'The modification could not be applied'
        stage('fault', { error: message })
        setError(message)
        record(false, { channel: 'spicetify' })
        await delay(1700)
      } finally {
        setInjectionRun(null)
        setBusy(false)
      }
      return
    }

    /**
     * Give up on this layer — and take it back off the application.
     *
     * A failed layer is not inert. Its first statement removes every existing
     * Modable node, so by the time it throws it has already destroyed whatever
     * was there and put nothing in its place; a theme layer that got as far as
     * setting its class leaves the application stuck looking wrong. Reverting
     * before reporting means a fault costs the user nothing but the attempt.
     */
    const fail = async (message: string) => {
      stage('fault', { error: message })
      let note = message
      try {
        const undo = await api.revertLayer(layer.targetId, layer.marks)
        if (undo.success && undo.removed) {
          note = `${message} The layer was removed from ${selectedApp?.name ?? 'the application'}.`
        }
      } catch {
        // Reverting is best-effort: the original failure is the thing to report.
      }
      setError(note)
      record(false)
      await delay(1700)
    }

    const write = async () => {
      stage('inject')
      // layer.targetId is the window this layer was read from and written for.
      // The server refuses anything else, so a layer cannot land in a window it
      // was not written against.
      const [result] = await Promise.all([
        api.injectCode(layer.code, layer.targetId, layer.marks),
        delay(520),
      ])
      return result
    }

    try {
      // Reading is the patient stage; the mosaic answers the scan row by row.
      stage('understand')
      await Promise.all([api.isDebuggerReady().catch(() => null), delay(4800)])

      stage('plan')
      await delay(1400)

      let result = await write()

      // The script threw inside the application.
      if (!result?.success) {
        return await fail(result?.error || 'Injection failed')
      }

      stage('verify')
      await delay(620)

      /* It ran without throwing but left nothing behind, which means the anchor
         it chose is not in this application. That used to pass as success —
         the sequence only waited here. Read the surface again and give the
         model one chance to place the layer somewhere that exists. */
      if (!result.verified) {
        stage('understand')
        const repaired = await repairLayer(layer, 'nothing appeared in the application')

        if (!repaired) {
          return await fail('The layer ran but nothing appeared, and the rewrite did not land.')
        }

        layer = repaired
        stage('plan')
        await delay(1400)

        result = await write()
        if (!result?.success) {
          return await fail(result?.error || 'Injection failed')
        }
        if (!result.verified) {
          return await fail('The layer ran but nothing appeared in the application.')
        }

        stage('verify')
        await delay(620)
      }

      stage('done')
      record(true)
      setInjected(true)
      await delay(1150)
    } catch (err) {
      await fail(err instanceof Error ? err.message : 'Injection failed')
    } finally {
      setInjectionRun(null)
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 pl-4 max-w-[720px]" style={{ boxShadow: 'inset 2px 0 0 var(--filament-dim)' }}>
      <span style={{ color: 'var(--fg-0)' }}>{mod.name}</span>
      <p className="mt-1" style={{ color: 'var(--fg-2)' }}>{mod.description}</p>

      {error && (
        <p className="mt-2 whitespace-pre-wrap" style={{ color: 'var(--fault)' }}>{error}</p>
      )}

      {/* Spotify's modifications load at the next start, so saying nothing here
          would read as a mod that silently did not work. */}
      {hint && !error && (
        <p className="mt-2" style={{ color: 'var(--fg-3)' }}>{hint}</p>
      )}

      <div className="flex items-center gap-2 mt-3">
        {injected ? (
          <span className="flex items-center gap-2.5" style={{ color: 'var(--filament)' }}>
            <span className="mdb-dot mdb-dot-warm" /> written
          </span>
        ) : (
          <button
            onClick={handleInject}
            disabled={busy || !canInject}
            className="mdb-cmd mdb-cmd-lead mdb-cmd-inline"
            title={
              canInject
                ? mod.channel === 'spicetify'
                  ? 'Write this modification and apply it with Spicetify'
                  : 'Write this layer into the running application'
                : 'Start the application first'
            }
          >
            <span>›</span>
            <span style={{ color: 'var(--filament)' }}>
              {mod.channel === 'spicetify' ? 'apply to spotify' : 'write layer'}
            </span>
          </button>
        )}
        <button
          onClick={onOpen}
          className="mdb-cmd mdb-cmd-inline"
          title={showing ? 'Close the code panel' : 'Show this code in the panel'}
        >
          <span>›</span>
          <span>{showing ? 'hide code' : 'show code'}</span>
        </button>
      </div>
    </div>
  )
}
