import { motion, useTransform, MotionValue } from 'framer-motion'
import { LayerEdge } from './LayerEdge'
import {
  SurfacePhase,
  SurfaceTarget,
  SurfaceMotion,
  SurfaceRig,
  planeGap,
} from './SurfaceLayer'
import { leftVertex, planeQuad, rigFrame, RigFrame, RigState } from './surfaceGeometry'

/**
 * The object is annotated the way a part is annotated on a drawing.
 *
 * Every leader is a pure horizontal ruled at its own plane's left vertex, and
 * it terminates on the silhouette as that silhouette is actually drawn —
 * solved from the same matrices the rig uses, on the same motion values the
 * planes are driven by, so the two cannot drift by a pixel. When the stack
 * parts, the labels part with it and the leaders shorten, because the object
 * has moved toward you.
 */

/** Width reserved for the label itself. */
const LABEL_W = 116
/** Shortest a leader is ever allowed to get — at the fully parted stack. */
const MIN_LEADER = 44
/** Air between the label and the start of its leader. */
const LEAD_GAP = 14
/** Slack for the pointer parallax swinging the vertex further out. */
const SWING = 12

function restState(size: number, gap: number): RigState {
  return { size, gap, lift: 0, tiltX: 0, tiltZ: 0, peelX: 0, peelY: 0 }
}

/**
 * How far the rotated square hangs past its own box, at the object's widest
 * moment — the parted stack, which sits nearest the viewer and so projects
 * largest. The composition has to reserve this on both sides or the object
 * gets sliced by the frame.
 */
export function objectOverhang(size: number): number {
  return Math.ceil(-leftVertex(planeQuad(2, restState(size, 82))).x + SWING)
}

/** Room the label rail needs, to the left of the object's own overhang. */
export function calloutRailWidth(size: number): number {
  return objectOverhang(size) + MIN_LEADER + LEAD_GAP + LABEL_W
}

export function SurfaceCallouts({
  size,
  rail,
  phase,
  targets,
  rig,
  motion: sm,
  hover = 0,
}: {
  size: number
  rail: number
  phase: SurfacePhase
  targets: SurfaceTarget[]
  rig: SurfaceRig
  motion: SurfaceMotion
  hover?: number
}) {
  /** Stage-local x where every leader begins. Negative: left of the stage. */
  const leadStart = -rail + LABEL_W + LEAD_GAP

  const frame = useTransform<number, RigFrame>(
    [sm.gap, sm.lift, rig.tiltX, rig.tiltZ, rig.peelX, rig.peelY],
    ([gap, lift, tiltX, tiltZ, peelX, peelY]) =>
      rigFrame({ size, gap, lift, tiltX, tiltZ, peelX, peelY }),
  )

  const leaders = useTransform(frame, (f: RigFrame) =>
    f.rows
      .map((y, i) => `M ${leadStart} ${y.toFixed(2)} L ${f.ends[i].toFixed(2)} ${y.toFixed(2)}`)
      .join(' '),
  )

  // unrolled so the hook order never depends on the data
  const y0 = useTransform(frame, (f: RigFrame) => f.rows[0])
  const y1 = useTransform(frame, (f: RigFrame) => f.rows[1])
  const y2 = useTransform(frame, (f: RigFrame) => f.rows[2])
  const x0 = useTransform(frame, (f: RigFrame) => f.ends[0])
  const x1 = useTransform(frame, (f: RigFrame) => f.ends[1])
  const x2 = useTransform(frame, (f: RigFrame) => f.ends[2])
  const rows = [
    { i: 2, y: y2, x: x2 },
    { i: 1, y: y1, x: x1 },
    { i: 0, y: y0, x: x0 },
  ]

  const written = phase === 'inject' || phase === 'done'

  return (
    <div className="sl-annot" aria-hidden="true">
      <svg
        className="sl-lead"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ left: rail, top: 0 }}
      >
        <motion.path d={leaders} />
        {rows.map(({ i, x, y }) => (
          <motion.circle key={i} r={1.7} cx={x} cy={y} className="sl-lead-dot" />
        ))}
      </svg>

      {rows.map(({ i, y }) => {
        const t = targets[2 - i]
        const isTop = i === 2
        return (
          <motion.div
            key={i}
            className="sl-callout"
            style={{ width: LABEL_W, y: y as MotionValue<number> }}
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
              className="sl-callout-edge"
            />
          </motion.div>
        )
      })}
    </div>
  )
}

/** Re-exported so the modal can keep its rest gap and the rail in step. */
export { planeGap }
