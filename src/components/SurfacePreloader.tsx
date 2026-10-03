import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AsciiArt } from './AsciiArt'
import type { InstalledApp } from '../stores/projectStore'

/** Nominal length of the read, for the counter's pacing. */
const READ_WINDOW = 5600

/** Seconds the cover takes to clear. The reference's dissolve runs ~1.2s. */
const CLEAR = 1.05

/**
 * The cover, tiled once at module load.
 *
 * Same construction as the surface mosaic — varied spans, shuffled order — so
 * the reveal and the write read as the same gesture at two scales.
 */
const COVER = (() => {
  const cols = 18
  const rows = 11
  let seed = 23
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

  const tiles: { c: number; r: number; w: number; order: number }[] = []
  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < cols) {
      const w = Math.min(cols - c, 1 + Math.floor(rand() * 3.6))
      tiles.push({ c, r, w, order: 0 })
      c += w
    }
  }

  const idx = tiles.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  idx.forEach((tile, k) => {
    tiles[tile].order = k / idx.length
  })

  return { cols, rows, tiles }
})()

/**
 * THE PRELOADER — the reference's front half, full bleed.
 *
 * The motion reference gives two thirds of its length to one object on empty
 * black with a tiny counter beneath it and nothing else on screen, then clears
 * to the loaded page in a hard block dissolve. That is a full-viewport beat,
 * not a panel with a hero inside it, and building it inside a card is why
 * every previous pass read as close but not it.
 *
 * So this covers everything. The object is the target application's own ASCII
 * logo — the same artwork the workspace masthead draws — and when the read
 * lands, the cover breaks into blocks and the working panel is simply behind
 * it, already there.
 */
export function SurfacePreloader({
  app,
  clearing,
}: {
  app: InstalledApp
  clearing: boolean
}) {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState(0)
  const startedAt = useRef(Date.now())

  useEffect(() => {
    if (clearing) return
    startedAt.current = Date.now()
    setPhase(0)
    const t = setInterval(() => setPhase(Date.now() - startedAt.current), 60)
    return () => clearInterval(t)
  }, [clearing])

  /* Stalls just short while the read runs and only reads full once the stage
     has actually ended — a counter that reaches 100 before the work does is
     the one thing here that would feel fake. */
  const pct = clearing ? 100 : Math.min(96, Math.round((phase / READ_WINDOW) * 100))

  return (
    <div className={`mdb-pre ${clearing ? 'is-clearing' : ''}`} aria-hidden="true">
      {COVER.tiles.map((t, i) => (
        <span
          key={i}
          className="mdb-pre-tile"
          style={
            {
              left: `${(t.c / COVER.cols) * 100}%`,
              top: `${(t.r / COVER.rows) * 100}%`,
              width: `${(t.w / COVER.cols) * 100}%`,
              height: `${100 / COVER.rows}%`,
              '--d': `${t.order * CLEAR}s`,
            } as React.CSSProperties
          }
        />
      ))}

      <motion.div
        className="mdb-pre-object"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: clearing ? 0 : 1 }}
        transition={{ duration: clearing ? 0.26 : 0.5, ease: 'linear' }}
      >
        {/* turns on its own axis rather than fading, because it has mass */}
        <motion.div
          animate={reduce ? undefined : { rotateY: [-26, 26, -26], rotateX: [4, -3, 4] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
          style={{ transformPerspective: 900 }}
        >
          <AsciiArt
            src={app.realIcon}
            emoji={app.icon}
            cols={44}
            lift
            className="mdb-ascii-xl"
          />
        </motion.div>

        <div className="mdb-pre-meter">
          <span className="mdb-label">reading {app.name}</span>
          <span className="mdb-mono">{pct}%</span>
        </div>
      </motion.div>
    </div>
  )
}
