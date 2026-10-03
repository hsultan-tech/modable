import { motion } from 'framer-motion'
import { LayerEdge } from './LayerEdge'
import { SurfacePhase } from './SurfaceLayer'

/**
 * The census.
 *
 * Modable's first act on any machine is to look at what is installed and work
 * out which of it can be opened. That reading exists before a key does, so it
 * is printed here, in full, under the intake — the screen is a readout of this
 * computer rather than a page about a product. The three surfaces standing on
 * the stage to the right are marked so the two halves of the screen refer to
 * each other.
 */

export interface CensusApp {
  name: string
  version: string
  isElectron: boolean
  /** Whether Modable can actually modify this app, by whatever route. Not a
   *  synonym for isElectron — Spotify is reachable through Spicetify while
   *  never being Electron. Absent on older callers, which meant isElectron. */
  reachable?: boolean
  channel?: 'cdp' | 'spicetify'
}

/** What this row should say about whether Modable can modify the app. The
 *  route it would take to get there is not the user's concern. */
function note(a: CensusApp): string {
  const reachable = a.reachable ?? a.isElectron
  if (reachable) return 'reachable'
  return a.channel === 'spicetify' ? 'spicetify unavailable' : 'no electron framework'
}

export type CensusState = 'surveying' | 'ready' | 'empty'

const PLACEHOLDERS = ['————————', '——————', '—————————']

export function SurfaceCensus({
  apps,
  onStage,
  state,
  phase,
}: {
  apps: CensusApp[]
  /** Names currently carried by the object. */
  onStage: string[]
  state: CensusState
  phase: SurfacePhase
}) {
  const reachable = apps.filter(a => a.reachable ?? a.isElectron).length

  const summary =
    state === 'surveying'
      ? 'reading'
      : state === 'empty'
        ? 'none in reach'
        : `${apps.length} found · ${reachable} reachable`

  return (
    <section className="mdb-census" aria-label="Surfaces on this machine">
      <div className="mdb-census-head">
        <span className="mdb-label" style={{ letterSpacing: '.16em' }}>
          Surfaces on this machine
        </span>
        <span
          className="mdb-label mdb-census-sum"
          style={{ letterSpacing: '.14em' }}
          aria-live="polite"
        >
          {summary}
        </span>
      </div>

      {state === 'empty' ? (
        <p className="mdb-census-void">
          Nothing on this machine ships an Electron framework, so there is no surface to lift
          yet. Connect anyway — Modable looks again every time you open it.
        </p>
      ) : (
        <ul className="mdb-census-list">
          {state === 'surveying'
            ? PLACEHOLDERS.map((p, i) => (
                <li key={i} className="mdb-census-row is-waiting">
                  <LayerEdge written={0} slots={4} className="mdb-census-edge" />
                  <span className="mdb-census-name">{p}</span>
                  <span className="mdb-census-ver" />
                  <span className="mdb-census-note">looking</span>
                </li>
              ))
            : apps.map((a, i) => {
                const staged = onStage.indexOf(a.name)
                const isStaged = staged > -1
                // the top plane is the one Modable writes to
                const wrote = isStaged && staged === 0 && (phase === 'inject' || phase === 'done')
                return (
                  <motion.li
                    key={a.name}
                    className={`mdb-census-row ${isStaged ? 'is-staged' : ''} ${
                      (a.reachable ?? a.isElectron) ? '' : 'is-shut'
                    }`}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.4, delay: 0.06 * i, ease: [0.2, 0.75, 0.25, 1] }}
                  >
                    <LayerEdge
                      written={wrote ? 1 : 0}
                      reachable={a.reachable ?? a.isElectron}
                      slots={4}
                      className="mdb-census-edge"
                    />
                    <span className="mdb-census-name">{a.name}</span>
                    <span className="mdb-census-ver">
                      {a.version === 'Unknown' ? 'no version' : a.version}
                    </span>
                    <span className="mdb-census-note">
                      {wrote ? '+1 layer' : isStaged ? 'on the stage' : note(a)}
                    </span>
                  </motion.li>
                )
              })}
        </ul>
      )}
    </section>
  )
}
