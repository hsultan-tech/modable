import { motion, useReducedMotion } from 'framer-motion'
import type { InjectionRecord } from '../stores/projectStore'

/**
 * THE EVENT FEED.
 *
 * The rail used to be a count and a list of names — a summary of things that
 * had finished. A control surface wants the opposite: the record of what the
 * system did, newest first, in the order it happened.
 *
 * Every row here is a real event. Nothing is synthesised to make the feed look
 * busier than the machine actually is: a quiet machine reads quiet, which is
 * information too.
 */

type Kind = 'write' | 'fault' | 'scan'

export interface FeedEvent {
  id: string
  kind: Kind
  timestamp: number
  /** What happened, in the interface's voice. */
  title: string
  /** Which target it happened to. */
  target?: string
}

const TONE: Record<Kind, string> = {
  write: 'var(--filament)',
  fault: 'var(--fault)',
  scan: 'var(--xenon-mid)',
}

/** Turns what the store actually knows into an ordered event log. */
export function buildFeed(history: InjectionRecord[], lastScan: Date | null): FeedEvent[] {
  const events: FeedEvent[] = (history || []).map(r => ({
    id: r.id,
    kind: r.success ? 'write' : 'fault',
    timestamp: r.timestamp,
    title: r.modName,
    target: r.appName,
  }))

  if (lastScan) {
    events.push({
      id: 'scan-' + lastScan.getTime(),
      kind: 'scan',
      timestamp: lastScan.getTime(),
      title: 'scanned this machine',
    })
  }

  return events.sort((a, b) => b.timestamp - a.timestamp)
}

const clock = (t: number) =>
  new Date(t).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })

export function EventFeed({ events }: { events: FeedEvent[] }) {
  const reduce = useReducedMotion()

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex items-baseline justify-between shrink-0 mb-1">
        <span className="mdb-label">Event feed</span>
        <span className="mdb-chan">{events.length} logged</span>
      </div>

      {events.length === 0 ? (
        <p className="text-[11.5px] text-[var(--fg-3)] leading-relaxed pt-4 pr-2">
          Nothing has happened yet. Attach to a target and the reads and writes
          Modable performs will arrive here as they run.
        </p>
      ) : (
        <div className="min-h-0 overflow-y-auto pr-1 -mr-1 mt-2">
          {events.map((e, i) => (
            <motion.div
              key={e.id}
              initial={reduce ? false : { opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.028, duration: 0.24 }}
              className="mdb-feed-row"
            >
              <span className="mdb-feed-strip" style={{ background: TONE[e.kind] }} />
              <span className="min-w-0">
                {/* kind and time share a line: at 196px the feed cannot afford
                    a fixed timestamp column and still read */}
                <span className="flex items-baseline gap-2 mb-[3px]">
                  <span className="mdb-feed-kind" style={{ color: TONE[e.kind] }}>{e.kind}</span>
                  <span className="mdb-feed-t">{clock(e.timestamp)}</span>
                </span>
                <span className="block text-[11px] text-[var(--fg-2)] leading-snug truncate">
                  {e.title}
                </span>
                {e.target && (
                  <span className="mdb-chan block mt-[2px] truncate">{e.target}</span>
                )}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
