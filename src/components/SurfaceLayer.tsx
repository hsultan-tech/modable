import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion, useTransform } from 'framer-motion'

/**
 * The Surface Lift sequence, named the way the product names it.
 *
 *   attach   Modable takes hold and the stack lifts clear of the floor
 *   read     a plane of cold light passes down through every layer
 *   rewrite  the stack parts and a new layer is set into the opened seam
 *   inject   the layers close on it, elastically, and take the weight back
 *   done     the surface as it now is: modified, warm at the new layer
 */
export type SurfacePhase = 'rest' | 'attach' | 'read' | 'rewrite' | 'inject' | 'done'

export const SURFACE_STEPS = ['attach', 'read', 'rewrite', 'inject'] as const

/** How long each step of the sequence is held, in ms. */
export const SURFACE_TIMING: Record<(typeof SURFACE_STEPS)[number] | 'done', number> = {
  attach: 560,
  read: 880,
  rewrite: 760,
  inject: 700,
  done: 620,
}

/** Gap between planes while the stack is parted. Exported so the callout
 *  leaders can land on the same geometry the planes actually use. */
export const SPLIT_GAP = 82

/** Screen-space rise of one unit of local Z, given the rig's rotateX(52deg). */
export const Z_TO_SCREEN = Math.sin((52 * Math.PI) / 180)

/** Vertical travel of the whole object while an operation is running. */
export const LIFT_Y = -30

/** Gap between planes at each phase, matching the rig above. */
export function planeGap(phase: SurfacePhase, reduce: boolean): number {
  if (reduce) return 14
  if (phase === 'rewrite') return SPLIT_GAP
  if (phase === 'attach' || phase === 'read') return 28
  return 20
}

export interface SurfaceTarget {
  name: string
  version: string
  realIcon?: string
  isElectron: boolean
}

/** A region of a target application's window, in percentages of its face. */
type Region = { x: number; y: number; w: number; h: number; line?: boolean }

/**
 * The window layouts Modable actually meets. Drawn from the shape of each
 * app's chrome rather than invented, so the slabs read as three specific
 * programs rather than three decorated squares.
 */
function windowSchematic(name: string): Region[] {
  const rows = (from: number, count: number, x: number, w: number, step = 9): Region[] =>
    Array.from({ length: count }, (_, i) => ({
      x,
      y: from + i * step,
      w: w * (i % 3 === 2 ? 0.55 : i % 3 === 1 ? 0.86 : 1),
      h: 2,
      line: true,
    }))

  switch (name) {
    case 'Slack':
      return [
        { x: 3, y: 4, w: 8, h: 92 },
        { x: 13, y: 4, w: 24, h: 92 },
        { x: 39, y: 4, w: 58, h: 9 },
        ...rows(20, 6, 39, 52, 11),
        { x: 39, y: 86, w: 58, h: 10 },
      ]
    case 'Discord':
      return [
        { x: 3, y: 4, w: 7, h: 92 },
        { x: 12, y: 4, w: 21, h: 92 },
        { x: 35, y: 4, w: 42, h: 8 },
        ...rows(19, 6, 35, 40, 11),
        { x: 79, y: 4, w: 18, h: 92 },
      ]
    case 'VS Code':
      return [
        { x: 3, y: 4, w: 6, h: 92 },
        { x: 11, y: 4, w: 21, h: 92 },
        { x: 34, y: 4, w: 63, h: 7 },
        ...rows(17, 7, 37, 48, 9),
        { x: 34, y: 89, w: 63, h: 7 },
      ]
    case 'Notion':
      return [
        { x: 3, y: 4, w: 22, h: 92 },
        { x: 32, y: 12, w: 40, h: 7 },
        ...rows(27, 6, 32, 56, 10),
      ]
    default:
      return [
        { x: 3, y: 4, w: 20, h: 92 },
        { x: 27, y: 4, w: 70, h: 8 },
        ...rows(20, 6, 27, 58, 11),
      ]
  }
}

/** The one region Modable writes: a panel set into the app's own chrome. */
const WRITTEN_REGION: Region = { x: 56, y: 22, w: 38, h: 26 }

function Face({
  target,
  index,
  reading,
  written,
  reduce,
}: {
  target?: SurfaceTarget
  index: number
  reading: boolean
  written: boolean
  reduce: boolean
}) {
  const regions = windowSchematic(target?.name ?? '')
  return (
    <div className={`sl-face ${reading ? 'sl-face-read' : ''}`}>
      {regions.map((r, i) => (
        <div
          key={i}
          className={r.line ? 'sl-reg sl-reg-line' : 'sl-reg'}
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: r.line ? 2 : `${r.h}%` }}
        />
      ))}

      {/* the layer Modable sets into this surface */}
      {written && (
        <motion.div
          className="sl-reg sl-reg-new"
          style={{
            left: `${WRITTEN_REGION.x}%`,
            top: `${WRITTEN_REGION.y}%`,
            width: `${WRITTEN_REGION.w}%`,
            height: `${WRITTEN_REGION.h}%`,
          }}
          initial={reduce ? false : { opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 260, damping: 20, mass: 0.7 }
          }
        />
      )}

      {target?.realIcon && (
        <img
          src={target.realIcon}
          alt=""
          className="sl-mark"
          style={{ left: '6%', bottom: '7%', width: '8.5%' }}
        />
      )}

      {/* the cold read, one pass, staggered down the stack so the light
          reads as a single plane travelling through the object */}
      {reading && !reduce && (
        <motion.div
          className="absolute left-0 right-0 h-[46%]"
          style={{
            mixBlendMode: 'plus-lighter',
            background:
              'linear-gradient(180deg, transparent, rgba(111,180,228,.14) 54%, rgba(207,233,255,.62) 96%, rgba(207,233,255,.9) 100%)',
          }}
          initial={{ top: '-48%' }}
          animate={{ top: '102%' }}
          transition={{ duration: 0.62, ease: [0.5, 0, 0.5, 1], delay: (2 - index) * 0.11 }}
        />
      )}
    </div>
  )
}

/**
 * SIGNATURE — the Surface Layer.
 *
 * The face-on projection of the layer edge that sits a few pixels wide in the
 * sidebar: the same object, seen from above instead of from the side. Three
 * planes with real thickness, lit cold from the upper left, standing on the
 * room's floor.
 *
 * Each plane carries a real application found on this machine — the schematic
 * of its own window, drawn the way Modable reads it — so the object is a
 * reading of the user's desktop rather than an ornament.
 */
export function SurfaceLayer({
  phase = 'rest',
  size = 300,
  targets = [],
  interactive = true,
  onProximity,
  className = '',
}: {
  phase?: SurfacePhase
  size?: number
  targets?: SurfaceTarget[]
  interactive?: boolean
  onProximity?: (v: number) => void
  className?: string
}) {
  const reduce = useReducedMotion() ?? false
  const hostRef = useRef<HTMLDivElement>(null)

  // Pointer parallax, deliberately small — the object acknowledges you, it does
  // not follow you around.
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const spring = { stiffness: 110, damping: 18, mass: 0.6 }
  const tiltX = useSpring(useTransform(py, [-1, 1], [4.5, -4.5]), spring)
  const tiltZ = useSpring(useTransform(px, [-1, 1], [-4.5, 4.5]), spring)

  /**
   * Proximity: 0 at arm's length, 1 with the pointer over the object. The top
   * plane peels open in proportion, so the surface is lifted by the hand that
   * approaches it rather than by a timer — the headline, performed.
   */
  const near = useMotionValue(0)
  const peel = useSpring(near, { stiffness: 170, damping: 22, mass: 0.5 })
  const peelX = useTransform(peel, [0, 1], [0, -4.6])
  const peelY = useTransform(peel, [0, 1], [0, 4.6])
  const seamLight = useTransform(peel, [0, 1], [0, 0.5])
  const contactScale = useTransform(peel, [0, 1], [1, 1.1])
  const contactFade = useTransform(peel, [0, 1], [0.9, 0.58])

  useEffect(() => {
    if (!interactive || reduce) return
    const onMove = (e: PointerEvent) => {
      const el = hostRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const clamp = (v: number) => Math.max(-1, Math.min(1, v))
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      px.set(clamp((e.clientX - cx) / (r.width * 1.4)))
      py.set(clamp((e.clientY - cy) / (r.height * 1.4)))

      const reach = r.width * 0.95
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy)
      near.set(Math.max(0, Math.min(1, 1 - dist / reach)))
    }
    const onLeave = () => near.set(0)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
    }
  }, [interactive, reduce, px, py, near])

  // the sequence owns the object once it starts; the hand lets go
  useEffect(() => {
    if (phase !== 'rest') near.set(0)
  }, [phase, near])

  useEffect(() => {
    if (!onProximity) return
    return peel.on('change', onProximity)
  }, [peel, onProximity])

  const lifted = phase === 'attach' || phase === 'read' || phase === 'rewrite'
  const parted = phase === 'rewrite'
  const written = phase === 'rewrite' || phase === 'inject' || phase === 'done'
  const settled = phase === 'done'

  /** Local Z gap between planes, so separation happens perpendicular to them. */
  const gap = planeGap(phase, reduce)

  const planeTransition = reduce
    ? { duration: 0.2 }
    : phase === 'inject'
      ? { type: 'spring' as const, stiffness: 240, damping: 15, mass: 0.9 }
      : { type: 'spring' as const, stiffness: 150, damping: parted ? 21 : 15, mass: 0.9 }

  // the whole object leaves the ground for the duration of the operation
  const lift = reduce ? 0 : lifted ? LIFT_Y : 0

  return (
    <div
      ref={hostRef}
      className={`sl-stage ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* light and shadow sit on the floor, not in the stack */}
      <motion.div
        className="sl-pool"
        initial={false}
        animate={{ opacity: settled ? 1 : lifted ? 0.92 : 0.72, scale: settled ? 1.12 : 1 }}
        transition={{ duration: reduce ? 0.2 : 0.7, ease: [0.2, 0.75, 0.25, 1] }}
      />
      <motion.div
        className="sl-cast"
        initial={false}
        animate={{ opacity: lifted ? 0.85 : 0.62, scale: lifted ? 1.1 : 1 }}
        transition={{ duration: reduce ? 0.2 : 0.7, ease: [0.2, 0.75, 0.25, 1] }}
      />
      <motion.div
        className="sl-contact"
        initial={false}
        style={reduce ? undefined : { scaleX: contactScale, opacity: contactFade }}
        animate={lifted ? { opacity: 0.42, scaleX: 1.16 } : { opacity: 0.9, scaleX: 1 }}
        transition={{ duration: reduce ? 0.2 : 0.6, ease: [0.2, 0.75, 0.25, 1] }}
      />

      <motion.div
        style={{ transformStyle: 'preserve-3d' }}
        initial={false}
        animate={{ y: lift }}
        transition={
          reduce
            ? { duration: 0.2 }
            : { type: 'spring', stiffness: 190, damping: phase === 'inject' ? 13 : 20, mass: 0.9 }
        }
      >
        {/* outer rig carries the fixed isometric attitude */}
        <div
          className="sl-rig"
          style={{ width: size, height: size, transform: 'rotateX(52deg) rotateZ(-38deg)' }}
        >
          {/* inner rig carries the parallax, so the two never fight */}
          <motion.div
            className="sl-rig"
            style={{ width: size, height: size, rotateX: tiltX, rotateZ: tiltZ }}
          >
            {[0, 1, 2].map(i => {
              const isTop = i === 2
              const isSeam = i === 1
              // index 2 is the top plane, so targets read top-down
              const target = targets[2 - i]
              return (
                <motion.div
                  key={i}
                  className={`sl-plane ${isTop ? '' : 'sl-plane-sub'}`}
                  initial={false}
                  style={
                    isTop && !reduce
                      ? { transformOrigin: '0% 0%', rotateX: peelX, rotateY: peelY }
                      : undefined
                  }
                  animate={{ z: i * gap, opacity: isTop ? 1 : parted ? 0.96 : 0.8 }}
                  transition={planeTransition}
                >
                  {/* cold light in the seam the peel opens up */}
                  {isSeam && !reduce && <motion.div className="sl-seam" style={{ opacity: seamLight }} />}

                  <Face
                    target={target}
                    index={i}
                    reading={phase === 'read'}
                    written={isTop && written}
                    reduce={reduce}
                  />

                  {/* the moment the new layer takes hold — the only warm light here */}
                  {isTop && (
                    <motion.div
                      className="absolute inset-0 pointer-events-none"
                      initial={false}
                      animate={{ opacity: settled ? 1 : phase === 'inject' ? 0.55 : 0 }}
                      transition={{ duration: reduce ? 0.15 : 0.5 }}
                      style={{
                        borderRadius: 26,
                        boxShadow:
                          'inset 0 0 0 1.5px rgba(255,180,84,.46), inset 0 0 26px -10px rgba(255,180,84,.3)',
                      }}
                    />
                  )}
                </motion.div>
              )
            })}
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}
