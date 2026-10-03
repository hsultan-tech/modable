import { RefObject, useEffect, useRef } from 'react'
import {
  motion,
  animate,
  useMotionValue,
  useSpring,
  useTransform,
  MotionValue,
} from 'framer-motion'

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
  attach: 520,
  read: 1500,
  rewrite: 1700,
  inject: 660,
  done: 560,
}

/** Vertical travel of the whole object while an operation is running. */
export const LIFT_Y = -30

/** Local-Z gap between planes at each phase. */
export function planeGap(phase: SurfacePhase, reduce: boolean): number {
  if (reduce) return 16
  switch (phase) {
    case 'rewrite':
      return 82
    case 'attach':
    case 'read':
      return 38
    // the layers settle back tighter than they started: the surface is sealed
    case 'inject':
    case 'done':
      return 22
    default:
      return 30
  }
}

export interface SurfaceTarget {
  name: string
  version: string
  realIcon?: string
  isElectron: boolean
  /** Whether Modable can modify it at all — true for Spotify, which is
   *  reachable through Spicetify without being Electron. Optional because
   *  older callers only knew about isElectron. */
  reachable?: boolean
  channel?: 'cdp' | 'spicetify'
}

/* ============================================================
   Shared motion.

   The annotation has to land on the object to the pixel, on every frame and
   at every pointer position. The only way to guarantee that is for both
   components to read the *same* motion values rather than to run matched
   springs and hope they agree — so the gap, the lift and the pointer rig all
   live here and are handed to whoever needs them.
   ============================================================ */

export interface SurfaceMotion {
  gap: MotionValue<number>
  lift: MotionValue<number>
}

export function useSurfaceMotion(phase: SurfacePhase, reduce: boolean): SurfaceMotion {
  const gap = useMotionValue(planeGap('rest', reduce))
  const lift = useMotionValue(0)

  useEffect(() => {
    const lifted = phase === 'attach' || phase === 'read' || phase === 'rewrite'
    const g = planeGap(phase, reduce)
    const l = reduce ? 0 : lifted ? LIFT_Y : 0

    if (reduce) {
      animate(gap, g, { duration: 0.2 })
      animate(lift, l, { duration: 0.2 })
      return
    }
    // inject is the one underdamped moment: the stack closes past its rest
    // gap, rebounds, and settles
    animate(gap, g, {
      type: 'spring',
      stiffness: phase === 'inject' ? 240 : 150,
      damping: phase === 'rewrite' ? 21 : 15,
      mass: 0.9,
    })
    animate(lift, l, {
      type: 'spring',
      stiffness: 190,
      damping: phase === 'inject' ? 13 : 20,
      mass: 0.9,
    })
  }, [phase, reduce, gap, lift])

  return { gap, lift }
}

export interface SurfaceRig {
  hostRef: RefObject<HTMLDivElement>
  tiltX: MotionValue<number>
  tiltZ: MotionValue<number>
  peel: MotionValue<number>
  peelX: MotionValue<number>
  peelY: MotionValue<number>
  seamLight: MotionValue<number>
  contactScale: MotionValue<number>
  contactFade: MotionValue<number>
}

/**
 * Proximity: 0 at arm's length, 1 with the pointer over the object. The top
 * plane peels open in proportion, so the surface is lifted by the hand that
 * approaches it rather than by a timer — the headline, performed.
 */
export function useSurfaceRig(active: boolean): SurfaceRig {
  const hostRef = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const near = useMotionValue(0)

  const cfg = { stiffness: 110, damping: 18, mass: 0.6 }
  const tiltX = useSpring(useTransform(py, [-1, 1], [4.5, -4.5]), cfg)
  const tiltZ = useSpring(useTransform(px, [-1, 1], [-4.5, 4.5]), cfg)

  const peel = useSpring(near, { stiffness: 170, damping: 22, mass: 0.5 })
  const peelX = useTransform(peel, [0, 1], [0, -4.6])
  const peelY = useTransform(peel, [0, 1], [0, 4.6])
  const seamLight = useTransform(peel, [0, 1], [0, 0.5])
  const contactScale = useTransform(peel, [0, 1], [1, 1.1])
  const contactFade = useTransform(peel, [0, 1], [0.9, 0.58])

  useEffect(() => {
    if (!active) {
      px.set(0)
      py.set(0)
      near.set(0)
      return
    }
    const onMove = (e: PointerEvent) => {
      const el = hostRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (!r.width) return
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
  }, [active, px, py, near])

  return { hostRef, tiltX, tiltZ, peel, peelX, peelY, seamLight, contactScale, contactFade }
}

/* ============================================================
   The printed face.
   ============================================================ */

/** A region of a target application's window, in percentages of its face. */
type Region = {
  x: number
  y: number
  w: number
  h: number
  kind?: 'panel' | 'bar' | 'dot' | 'strip'
}

/** The three window controls every macOS app draws, top left. */
const CONTROLS: Region[] = [
  { x: 5.4, y: 5.2, w: 2.4, h: 2.4, kind: 'dot' },
  { x: 9.2, y: 5.2, w: 2.4, h: 2.4, kind: 'dot' },
  { x: 13, y: 5.2, w: 2.4, h: 2.4, kind: 'dot' },
]

/**
 * The window layouts Modable actually meets. Few, large regions rather than
 * many hairlines — under a 52°/-38° projection a stack of thin rows collapses
 * into hatching, and the point is that you should be able to name the app.
 */
function windowSchematic(name: string): Region[] {
  const chrome: Region[] = [{ x: 3, y: 3, w: 94, h: 8.5, kind: 'bar' }, ...CONTROLS]
  switch (name) {
    case 'Slack':
      return [
        ...chrome,
        { x: 3, y: 13.5, w: 9, h: 83.5, kind: 'panel' },
        { x: 13.5, y: 13.5, w: 22.5, h: 83.5, kind: 'panel' },
        { x: 38, y: 13.5, w: 59, h: 21 },
        { x: 38, y: 37, w: 59, h: 15 },
        { x: 38, y: 54.5, w: 59, h: 24 },
        { x: 38, y: 81, w: 59, h: 16, kind: 'strip' },
      ]
    case 'Discord':
      return [
        ...chrome,
        { x: 3, y: 13.5, w: 8, h: 83.5, kind: 'panel' },
        { x: 12.5, y: 13.5, w: 20.5, h: 83.5, kind: 'panel' },
        { x: 34.5, y: 13.5, w: 43, h: 27 },
        { x: 34.5, y: 42.5, w: 43, h: 36 },
        { x: 34.5, y: 81, w: 43, h: 16, kind: 'strip' },
        { x: 79, y: 13.5, w: 18, h: 83.5, kind: 'panel' },
      ]
    case 'VS Code':
      return [
        ...chrome,
        { x: 3, y: 13.5, w: 7, h: 77.5, kind: 'panel' },
        { x: 11.5, y: 13.5, w: 21, h: 77.5, kind: 'panel' },
        { x: 34, y: 13.5, w: 63, h: 8, kind: 'strip' },
        { x: 34, y: 23.5, w: 63, h: 67.5 },
        { x: 3, y: 92.5, w: 94, h: 4.5, kind: 'bar' },
      ]
    case 'Notion':
      return [
        ...chrome,
        { x: 3, y: 13.5, w: 25, h: 83.5, kind: 'panel' },
        { x: 31, y: 18, w: 40, h: 10, kind: 'strip' },
        { x: 31, y: 32, w: 66, h: 24 },
        { x: 31, y: 59, w: 66, h: 38 },
      ]
    default:
      return [
        ...chrome,
        { x: 3, y: 13.5, w: 22, h: 83.5, kind: 'panel' },
        { x: 27.5, y: 13.5, w: 69.5, h: 31 },
        { x: 27.5, y: 47, w: 69.5, h: 50 },
      ]
  }
}

/** The one region Modable writes: a panel set into the app's own chrome. */
const WRITTEN_REGION: Region = { x: 55, y: 30, w: 40, h: 27 }

const REG_CLASS: Record<string, string> = {
  panel: 'sl-reg sl-reg-panel',
  bar: 'sl-reg sl-reg-bar',
  strip: 'sl-reg sl-reg-strip',
  dot: 'sl-reg sl-reg-dot',
}

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
          className={r.kind ? REG_CLASS[r.kind] : 'sl-reg'}
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
        />
      ))}

      {target?.realIcon && (
        <span className="sl-mark" style={{ left: '4.4%', bottom: '5%', width: '15%' }}>
          <img src={target.realIcon} alt="" />
        </span>
      )}

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

      {/* the cold read, one pass, staggered down the stack so the light
          reads as a single plane travelling through the object */}
      {reading && !reduce && (
        <motion.div
          className="sl-sweep"
          initial={{ top: '-48%' }}
          animate={{ top: '102%' }}
          transition={{ duration: 0.6, ease: [0.5, 0, 0.5, 1], delay: (2 - index) * 0.11 }}
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
  rig,
  motion: sm,
  reduce = false,
  className = '',
}: {
  phase?: SurfacePhase
  size?: number
  targets?: SurfaceTarget[]
  rig: SurfaceRig
  motion: SurfaceMotion
  reduce?: boolean
  className?: string
}) {
  const lifted = phase === 'attach' || phase === 'read' || phase === 'rewrite'
  const parted = phase === 'rewrite'
  const written = phase === 'rewrite' || phase === 'inject' || phase === 'done'
  const settled = phase === 'done'

  const z0 = useTransform(sm.gap, g => 0 * g)
  const z1 = useTransform(sm.gap, g => 1 * g)
  const z2 = useTransform(sm.gap, g => 2 * g)
  const zs = [z0, z1, z2]

  return (
    <div
      ref={rig.hostRef}
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
        style={reduce ? undefined : { scaleX: rig.contactScale, opacity: rig.contactFade }}
        animate={lifted ? { opacity: 0.42, scaleX: 1.16 } : { opacity: 0.9, scaleX: 1 }}
        transition={{ duration: reduce ? 0.2 : 0.6, ease: [0.2, 0.75, 0.25, 1] }}
      />

      <motion.div style={{ transformStyle: 'preserve-3d', y: sm.lift }}>
        {/* outer rig carries the fixed isometric attitude */}
        <div
          className="sl-rig"
          style={{ width: size, height: size, transform: 'rotateX(52deg) rotateZ(-38deg)' }}
        >
          {/* inner rig carries the parallax, so the two never fight */}
          <motion.div
            className="sl-rig"
            style={{ width: size, height: size, rotateX: rig.tiltX, rotateZ: rig.tiltZ }}
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
                      ? {
                          z: zs[i],
                          transformOrigin: '0% 0%',
                          rotateX: rig.peelX,
                          rotateY: rig.peelY,
                        }
                      : { z: zs[i] }
                  }
                  animate={{ opacity: isTop ? 1 : parted ? 0.96 : 0.8 }}
                  transition={{ duration: reduce ? 0.2 : 0.45 }}
                >
                  {/* cold light in the seam the peel opens up */}
                  {isSeam && !reduce && (
                    <motion.div className="sl-seam" style={{ opacity: rig.seamLight }} />
                  )}

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
                      className="sl-warm"
                      initial={false}
                      animate={{ opacity: settled ? 1 : phase === 'inject' ? 0.55 : 0 }}
                      transition={{ duration: reduce ? 0.15 : 0.5 }}
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
