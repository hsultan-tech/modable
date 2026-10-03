import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowLeft, Search, Copy, Check, Trash2, X } from 'lucide-react'
import { DashboardSidebar } from './DashboardSidebar'
import { ApiKeyChangeModal } from './ProfileMenu'
import { useAppStore, type InjectionRecord } from '../stores/projectStore'

type Status = 'active' | 'failed' | 'reverted'
type Filter = 'all' | Status

const STATUS_WORD: Record<Status, string> = { active: 'Active', failed: 'Failed', reverted: 'Reverted' }

/** A record says whether its layer took. Nothing records a revert yet, so no
 *  record is ever "reverted" — the filter is there for when one is. */
function statusOf(r: InjectionRecord): Status {
  return r.success ? 'active' : 'failed'
}

/** The first sentence: what a row has room for. The drawer shows the rest. */
function gist(text: string) {
  const t = String(text || '').trim()
  const m = t.match(/^.*?[.!?](?=\s|$)/)
  return m ? m[0] : t
}

export function InjectionHistory({ onBack }: { onBack?: () => void }) {
  const { setApiKey, injectionHistory, deleteInjection, installedApps } = useAppStore()
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const reduce = useReducedMotion()

  const iconFor = useMemo(() => {
    const byName = new Map(installedApps.map(a => [a.name.toLowerCase(), a]))
    return (appName: string) => byName.get(appName.toLowerCase())
  }, [installedApps])

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: injectionHistory.length, active: 0, failed: 0, reverted: 0 }
    for (const r of injectionHistory) c[statusOf(r)]++
    return c
  }, [injectionHistory])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return injectionHistory
      .filter(r => filter === 'all' || statusOf(r) === filter)
      .filter(r => !q || `${r.modName} ${r.appName} ${r.description}`.toLowerCase().includes(q))
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [injectionHistory, filter, query])

  /** Chronological, broken only by day. */
  const days = useMemo(() => {
    const out: { label: string; records: InjectionRecord[] }[] = []
    for (const r of visible) {
      const label = dayLabel(r.timestamp)
      const last = out[out.length - 1]
      if (last && last.label === label) last.records.push(r)
      else out.push({ label, records: [r] })
    }
    return out
  }, [visible])

  const open = injectionHistory.find(r => r.id === openId) || null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="mdb h-full w-full flex overflow-hidden">
      <DashboardSidebar
        compact
        activeView="history"
        onLogout={() => setApiKey(null)}
        onRefresh={onBack}
        onHistory={() => {}}
        onSettings={() => setShowApiKeyModal(true)}
      />

      <main className="ly" data-drawer={open ? '' : undefined}>
        <div className="titlebar-drag ly-drag" />

        <nav className="ly-head ws-crumb no-drag" aria-label="Location">
          <button type="button" onClick={onBack}>
            <ArrowLeft size={13} strokeWidth={1.8} aria-hidden />
            Surfaces
          </button>
        </nav>

        <div className="ly-scroll">
          <div className="ly-col">
            <header className="ly-top">
              <h1 className="ly-title">Layers</h1>
              <p className="ly-sub">Everything Modable has changed on this machine.</p>
            </header>

            {injectionHistory.length > 0 && (
              <div className="ly-bar no-drag">
                <div className="ly-filters" role="tablist" aria-label="Filter layers">
                  {(['all', 'active', 'failed', 'reverted'] as Filter[]).map(f => (
                    <button
                      key={f}
                      type="button"
                      role="tab"
                      aria-selected={filter === f}
                      data-on={filter === f ? '' : undefined}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'all' ? 'All' : STATUS_WORD[f]}
                      <span className="ly-count">{counts[f]}</span>
                    </button>
                  ))}
                </div>
                <label className="ly-search">
                  <Search size={12} strokeWidth={1.8} aria-hidden />
                  <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search layers or apps"
                    aria-label="Search layers"
                    spellCheck={false}
                  />
                </label>
              </div>
            )}

            {injectionHistory.length === 0 ? (
              <Empty
                title="No layers yet"
                body="Pick an application, describe a change, and every layer Modable writes will be listed here."
              />
            ) : !visible.length ? (
              <Empty
                title={query ? 'Nothing matches' : `No ${STATUS_WORD[filter as Status].toLowerCase()} layers`}
                body={
                  query
                    ? `No layer or app matches “${query.trim()}”.`
                    : filter === 'reverted'
                      ? 'Layers you revert will show up here.'
                      : filter === 'failed'
                        ? 'Every layer Modable has written took.'
                        : 'Nothing is active right now.'
                }
              />
            ) : (
              <div className="ly-feed">
                {days.map(day => (
                  <section key={day.label} className="ly-day">
                    <h2 className="ly-day-t">{day.label}</h2>
                    <ul>
                      {day.records.map((r, i) => {
                        const app = iconFor(r.appName)
                        const status = statusOf(r)
                        return (
                          <motion.li
                            key={r.id}
                            initial={reduce ? false : { opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(i, 8) * 0.02, duration: 0.2 }}
                          >
                            <button
                              type="button"
                              className="ly-row"
                              data-on={openId === r.id ? '' : undefined}
                              aria-expanded={openId === r.id}
                              onClick={() => setOpenId(openId === r.id ? null : r.id)}
                            >
                              <AppGlyph name={r.appName} src={app?.realIcon} emoji={app?.icon} />
                              <span className="ly-main">
                                <span className="ly-name">{r.modName}</span>
                                <span className="ly-desc">
                                  <span className="ly-app">{r.appName}</span>
                                  {r.description && <> · {gist(r.description)}</>}
                                </span>
                              </span>
                              <span className="ly-status" data-s={status}>{STATUS_WORD[status]}</span>
                              <time className="ly-time" dateTime={new Date(r.timestamp).toISOString()}>
                                {relative(r.timestamp)}
                              </time>
                            </button>
                          </motion.li>
                        )
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {open && (
            <Detail
              key={open.id}
              record={open}
              app={iconFor(open.appName)}
              reduce={!!reduce}
              onClose={() => setOpenId(null)}
              onDelete={() => { deleteInjection(open.id); setOpenId(null) }}
            />
          )}
        </AnimatePresence>
      </main>

      <ApiKeyChangeModal isOpen={showApiKeyModal} onClose={() => setShowApiKeyModal(false)} />
    </div>
  )
}

function Detail({ record, app, reduce, onClose, onDelete }: {
  record: InjectionRecord
  app?: { realIcon?: string; icon?: string }
  reduce: boolean
  onClose: () => void
  onDelete: () => void
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const status = statusOf(record)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(record.code)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard refused; the code is still selectable below */ }
  }

  return (
    <motion.aside
      className="ly-drawer no-drag"
      aria-label={`${record.modName} details`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
      transition={{ duration: 0.2, ease: [0.2, 0.7, 0.3, 1] }}
    >
      <div className="ly-d-head">
        <span className="ly-d-app">
          <AppGlyph name={record.appName} src={app?.realIcon} emoji={app?.icon} small />
          {record.appName}
        </span>
        <button type="button" className="mdb-buffer-close" onClick={onClose} aria-label="Close details">
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      <div className="ly-d-body">
        <h3 className="ly-d-name">{record.modName}</h3>
        <p className="ly-d-meta">
          <span className="ly-status" data-s={status}>{STATUS_WORD[status]}</span>
          <span className="hs-sep" aria-hidden>·</span>
          <span>{new Date(record.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          <span className="hs-sep" aria-hidden>·</span>
          <span>{record.channel === 'spicetify' ? 'Spicetify' : 'CDP'}</span>
        </p>
        {record.description && <p className="ly-d-desc">{record.description}</p>}

        <div className="ly-d-code-h">
          <span>Generated code</span>
          <button type="button" onClick={copy} disabled={!record.code}>
            {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.8} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="ly-d-code">{record.code || '// no code was recorded for this layer'}</pre>
      </div>

      <div className="ly-d-foot">
        <button type="button" className="ly-d-remove" onClick={onDelete}>
          <Trash2 size={12} strokeWidth={1.8} />
          Remove from history
        </button>
      </div>
    </motion.aside>
  )
}

function AppGlyph({ name, src, emoji, small }: { name: string; src?: string; emoji?: string; small?: boolean }) {
  return (
    <span className={small ? 'ly-glyph is-small' : 'ly-glyph'} aria-hidden>
      {src ? <img src={src} alt="" draggable={false} /> : emoji || name.charAt(0).toUpperCase()}
    </span>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="ly-empty">
      <div className="ly-empty-t">{title}</div>
      <p>{body}</p>
    </div>
  )
}

function dayLabel(timestamp: number) {
  const d = new Date(timestamp)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(today) - start(d)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  })
}

function relative(timestamp: number) {
  const diff = Date.now() - timestamp
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  // Past a day, count calendar days so a row agrees with its day heading.
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(new Date()) - start(new Date(timestamp))) / 86400000)
  if (days <= 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
