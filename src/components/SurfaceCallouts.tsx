import { useEffect } from 'react'
import { motion, useSpring, useTransform, useReducedMotion, MotionValue } from 'framer-motion'
import { LayerEdge } from './LayerEdge'
import { SurfacePhase, SurfaceTarget, Z_TO_SCREEN, LIFT_Y, planeGap } from './SurfaceLayer'

/**
 * The object is annotated the way a part is annotated on a drawing: leaders
 * run out of the stack and land on named layers. Two things fall out of that.
 * The space between the headline and the object stops being a gap and starts
 * being structure, and the hero starts carrying real information — these are
 * the applications actually installed on this machine, one per plane.
 */

/** Geometry of the isometric rig, derived from rotateX(52deg) rotateZ(-38deg). */
const C38 = Math.cos((38 * Math.PI) / 180)
const S38 = Math.sin((38 * Math.PI) / 180)
const C52 = Math.cos((52 * Math.PI) / 180)
/** Left vertex of the rotated square, as a fraction of the half-size. */
const VX = -(C38 + S38)
const VY = -(S38 - C38) * C52
const PERSP = 1150

/** Vertical rhythm of the label rail when the stack is closed. */
const MIN_ROW = 42
/** Where the labels end, in stage-local x. Negative: left of the stage box. */
const LABEL_END = -126

export function SurfaceCallouts({
  size,
  phase,
  targets,
  status,
  hover = 0,
}: {
  size: number
  phase: SurfacePhase
  targets: SurfaceTarget[]
  status: string
  hover?: number
}) {
  const reduce = useReducedMotion() ?? false
  const h = size / 2
  const ox = size / 2
  const oy = size * 0.42

  const spring = { stiffness: 150, damping: 21, mass: 0.9 }
  const gap = useSpring(planeGap(phase, reduce), spring)
  const lift = useSpring(0, { stiffness: 190, damping: 20, mass: 0.9 })

  const lifted = phase === 'attach' || phase === 'read' || phase === 'rewrite'
  useEffect(() => {
    gap.set(planeGap(phase, reduce))
    lift.set(reduce ? 0 : lifted ? LIFT_Y : 0)
  }, [phase, reduce, lifted, gap, lift])

  /** Where plane `i`'s left vertex projects to, in stage-local coordinates. */
  const vertex = (g: number, l: number, i: number) => {
    const k = PERSP / (PERSP - i * g * C52)
    const bx = h + VX * h
    const by = h + VY * h - Z_TO_SCREEN * i * g + l
    return { x: ox + (bx - ox) * k, y: oy + (by - oy) * k }
  }

  /**
   * Label rows follow their plane, but never closer together than the type
   * can stand — so a closed stack reads as an evenly spaced rail and a parted
   * one visibly pulls its labels apart with it.
   */
  const rowY = (g: number, l: number, i: number) => {
    const mid = vertex(g, l, 1)
    const own = vertex(g, l, i)
    const step = Math.abs(vertex(g, l, 2).y - mid.y)
    const scale = step < MIN_ROW ? MIN_ROW / Math.max(step, 0.001) : 1
    return mid.y + (own.y - mid.y) * scale
  }

  // unrolled so the hook order never depends on the data
  const y2 = useTransform<number, number>([gap, lift], ([g, l]) => rowY(g, l, 2))
  const y1 = useTransform<number, number>([gap, lift], ([g, l]) => rowY(g, l, 1))
  const y0 = useTransform<number, number>([gap, lift], ([g, l]) => rowY(g, l, 0))
  const rows = [
    { i: 2, y: y2 },
    { i: 1, y: y1 },
    { i: 0, y: y0 },
  ]

  const leaders = useTransform<number, string>([gap, lift], ([g, l]) =>
    [2, 1, 0]
      .map(i => {
        const v = vertex(g, l, i)
        const y = rowY(g, l, i)
        return `M ${LABEL_END + 10} ${y} L ${LABEL_END + 30} ${y} L ${v.x + 7} ${v.y}`
      })
      .join(' '),
  )

  const written = phase === 'inject' || phase === 'done'

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <motion.svg
        className="sl-lead"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ left: 0, top: 0 }}
      >
        <motion.path d={leaders} />
      </motion.svg>

      {/* The survey heading. It is context for a stack at rest; once the
          sequence starts the labels climb into its line, so it steps aside. */}
      <motion.div
        className="absolute mdb-label text-right whitespace-nowrap"
        style={{
          right: size - LABEL_END,
          top: 0,
          transform: `translateY(${oy + VY * h - MIN_ROW - 36}px)`,
          fontSize: 9,
          letterSpacing: '.18em',
          color: 'var(--fg-3)',
        }}
        initial={false}
        animate={{ opacity: phase === 'rest' ? 1 : 0 }}
        transition={{ duration: reduce ? 0 : 0.32 }}
      >
        {status}
      </motion.div>

      {rows.map(({ i, y }) => {
        const t = targets[2 - i]
        const isTop = i === 2
        return (
          <motion.div
            key={i}
            className="sl-callout absolute"
            style={{
              right: size - LABEL_END,
              top: -10,
              y: y as MotionValue<number>,
            }}
          >
            <span
              className="sl-callout-name"
              style={
                isTop && written
                  ? { color: 'var(--filament)' }
                  : isTop && hover > 0.05
                    ? { color: 'var(--xenon)' }
                    : undefined
              }
            >
              {t?.name ?? '————'}
            </span>
            <span
              className="sl-callout-meta"
              style={isTop && written ? { color: 'var(--filament-dim)' } : undefined}
            >
              {isTop && written ? '+1 layer' : (t?.version ?? '')}
            </span>
            <LayerEdge
              written={isTop && written ? 1 : 0}
              reachable={t ? t.isElectron : false}
              slots={4}
              className="w-[4px] h-[13px] shrink-0"
            />
          </motion.div>
        )
      })}
    </div>
  )
}
