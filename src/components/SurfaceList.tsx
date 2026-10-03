import type { InstalledApp } from '../stores/projectStore'

/**
 * THE RAIL — detected applications, as selectable runtime surfaces.
 *
 * Deliberately not cards. A target here is one row you pick, the way you pick
 * a file or a device: a port of light down its edge when Modable can reach it,
 * the name, its channel, and the layers it already carries. The selected row
 * owns the centre of the screen, so selection has to read instantly.
 */
/**
 * Enough of a version to identify a build, at the width the rail actually has.
 * "4.47.65" needs 43px in a 33px box and rendered as "4.4…" — the one label on
 * screen that could not be read. The exact string stays in the row's title.
 */
function short(v: string): string {
  const parts = v.split('.')
  return parts.length > 2 ? parts.slice(0, 2).join('.') : v
}

/** How long ago the last layer landed on a target. */
function ago(at?: number): string {
  if (!at) return '—'
  const m = Math.floor((Date.now() - at) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

export function SurfaceList({
  apps, selected, layersByApp, lastWriteByApp, onSelect,
}: {
  apps: InstalledApp[]
  /** Path of the app whose surface is open in the centre. */
  selected?: string
  layersByApp: Map<string, number>
  /** When each target last took a layer. */
  lastWriteByApp?: Map<string, number>
  onSelect: (app: InstalledApp) => void
}) {
  return (
    <div className="mdb-rail">
      <div className="flex items-baseline justify-between shrink-0 mb-2.5 pl-3">
        <span className="mdb-label">Surfaces</span>
        <span className="mdb-chan">{String(apps.length).padStart(2, '0')}</span>
      </div>

      <div className="min-h-0 overflow-y-auto -mr-1 pr-1" role="listbox" aria-label="Detected applications">
        {apps.map(app => {
          const reachable = app.reachable ?? app.isElectron
          const layers = Math.min(4, layersByApp.get(app.name) || 0)
          const isOpen = selected === app.path

          return (
            <button
              key={app.path}
              type="button"
              role="option"
              aria-selected={isOpen}
              data-state={reachable ? 'attached' : 'closed'}
              disabled={!reachable}
              onClick={() => onSelect(app)}
              className="mdb-rail-row"
              title={
                reachable
                  ? `Open ${app.name} — v${app.version}`
                  : `Modable cannot modify ${app.name} — ${app.blockedBecause || 'it is not reachable'}`
              }
            >
              <span className="mdb-rail-port" />

              <span className="mdb-rail-icon">
                {app.realIcon
                  ? <img src={app.realIcon} alt="" />
                  : <span className="text-[11px] leading-none">{app.icon}</span>}
              </span>

              <span className="min-w-0">
                <span className="mdb-rail-name block">{app.name}</span>
                <span className="mdb-rail-meta mdb-chan">
                  <span className="shrink-0">
                    {/* abbreviated: the rail is 212px, and "spicetify" beside a
                        version truncated the version mid-number */}
                    {app.channel === 'spicetify' ? 'spcfy' : reachable ? 'cdp' : 'closed'}
                  </span>
                  {app.version && app.version !== 'Unknown' && (
                    <>
                      <span className="mdb-rail-sep shrink-0">/</span>
                      <span className="shrink-0">{short(app.version)}</span>
                    </>
                  )}
                </span>
              </span>

              <span className="flex items-center gap-2.5 shrink-0">
                {/* only drawn when there is something to draw */}
                {layers > 0 && (
                  <span className="mdb-lyrs" aria-label={`${layers} layers written`}>
                    {Array.from({ length: layers }, (_, i) => (
                      <span key={i} className="mdb-lyr is-written" />
                    ))}
                  </span>
                )}
                <span className="mdb-chan" style={{ minWidth: 22, textAlign: 'right' }}>
                  {ago(lastWriteByApp?.get(app.name))}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
