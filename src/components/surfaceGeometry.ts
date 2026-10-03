/**
 * The rig, solved exactly.
 *
 * The Surface Layer is three squares carried through four nested CSS
 * transforms and then a perspective divide. Anything that wants to touch the
 * object — a leader line, a label, a tick — has to know where the silhouette
 * actually lands on screen, not where the centre of the plane projects to.
 *
 * A perspective projection maps straight lines to straight lines, so the
 * projected plane is an honest quadrilateral between its four projected
 * corners. That makes "where does a horizontal at height y meet the object"
 * an exact question with an exact answer, which is what this module returns.
 */

export type Pt = { x: number; y: number }
/** Row-major 4x4, matching CSS transform semantics. */
type M4 = number[]

const rad = (d: number) => (d * Math.PI) / 180

function mul(a: M4, b: M4): M4 {
  const o = new Array<number>(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c]
      o[r * 4 + c] = s
    }
  }
  return o
}

const rotX = (d: number): M4 => {
  const c = Math.cos(rad(d))
  const s = Math.sin(rad(d))
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}
const rotY = (d: number): M4 => {
  const c = Math.cos(rad(d))
  const s = Math.sin(rad(d))
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}
const rotZ = (d: number): M4 => {
  const c = Math.cos(rad(d))
  const s = Math.sin(rad(d))
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}
const trans = (x: number, y: number, z: number): M4 =>
  [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1]

const apply = (m: M4, p: readonly [number, number, number]): [number, number, number] => [
  m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
  m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
  m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
]

/* ---- the rig's fixed attitude, mirrored from SurfaceLayer's own CSS ---- */

/** `.sl-rig` outer: rotateX(52deg) rotateZ(-38deg) */
export const RIG_X = 52
export const RIG_Z = -38
/** `.sl-stage`: perspective / perspective-origin */
export const PERSPECTIVE = 1150
export const ORIGIN_Y = 0.42

export interface RigState {
  size: number
  /** local-Z distance between planes */
  gap: number
  /** screen-space rise of the whole object during an operation */
  lift: number
  tiltX: number
  tiltZ: number
  peelX: number
  peelY: number
}

function project(p: [number, number, number], size: number): Pt {
  const ox = size / 2
  const oy = size * ORIGIN_Y
  const x = size / 2 + p[0]
  const y = size / 2 + p[1]
  const k = PERSPECTIVE / Math.max(120, PERSPECTIVE - p[2])
  return { x: ox + (x - ox) * k, y: oy + (y - oy) * k }
}

/** `.sl-plane` border-radius. The corner a leader wants is a rounded one, and
 *  the difference is ~12px on screen — the whole of iteration one's miss. */
export const PLANE_RADIUS = 26
/** Samples per corner arc. Twelve holds the error under a third of a pixel. */
const ARC_SEG = 12

/** The plane's real outline in local coordinates: four edges, four arcs. */
function outline(h: number): Array<[number, number]> {
  const r = Math.min(PLANE_RADIUS, h)
  const pts: Array<[number, number]> = []
  const corners: Array<[number, number, number]> = [
    [h - r, -h + r, -Math.PI / 2],
    [h - r, h - r, 0],
    [-h + r, h - r, Math.PI / 2],
    [-h + r, -h + r, Math.PI],
  ]
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= ARC_SEG; i++) {
      const a = a0 + (Math.PI / 2) * (i / ARC_SEG)
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
  }
  return pts
}

/**
 * Plane `i` as it is actually drawn: its projected outline in stage-local
 * coordinates (0,0 is the stage box's top-left; values go negative, because
 * the rotated square overhangs its own box).
 */
export function planeQuad(i: number, s: RigState, withPeel = true): Pt[] {
  const h = s.size / 2

  // wrapper lift → outer rig → parallax rig
  let m = mul(trans(0, s.lift, 0), mul(rotX(RIG_X), rotZ(RIG_Z)))
  m = mul(m, mul(rotX(s.tiltX), rotZ(s.tiltZ)))

  // the plane's own transform. framer writes translate before rotate.
  const z = i * s.gap
  let e = trans(0, 0, z)
  if (i === 2 && withPeel && (s.peelX !== 0 || s.peelY !== 0)) {
    // transform-origin: 0% 0% — the plane hinges on its far corner
    e = mul(
      trans(-h, -h, 0),
      mul(e, mul(rotX(s.peelX), mul(rotY(s.peelY), trans(h, h, 0)))),
    )
  }
  m = mul(m, e)

  return outline(h).map(c => project(apply(m, [c[0], c[1], 0]), s.size))
}

export function rigQuads(s: RigState, withPeel = true): Pt[][] {
  return [planeQuad(0, s, withPeel), planeQuad(1, s, withPeel), planeQuad(2, s, withPeel)]
}

/** The leftmost projected corner — the vertex a leader wants to land on. */
export function leftVertex(quad: Pt[]): Pt {
  let best = quad[0]
  for (const p of quad) if (p.x < best.x) best = p
  return best
}

/**
 * Where a horizontal ruled at `y` first meets this quad, or null if the ruling
 * misses it entirely. Exact: the quad's edges are straight in screen space.
 */
export function leftEdgeAt(quad: Pt[], y: number): number | null {
  let best = Number.POSITIVE_INFINITY
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % quad.length]
    const lo = Math.min(a.y, b.y)
    const hi = Math.max(a.y, b.y)
    if (y < lo || y > hi) continue
    if (Math.abs(b.y - a.y) < 1e-6) {
      best = Math.min(best, a.x, b.x)
      continue
    }
    const t = (y - a.y) / (b.y - a.y)
    const x = a.x + (b.x - a.x) * t
    if (x < best) best = x
  }
  return Number.isFinite(best) ? best : null
}

export interface RigFrame {
  /** y of each plane's left vertex, ignoring the peel so labels never jitter. */
  rows: number[]
  /** x where a horizontal at rows[i] first touches the object as drawn. */
  ends: number[]
}

/**
 * One frame of the annotation: three horizontals, each terminating on the
 * silhouette it is pointing at. Because the ruling is taken at the plane's own
 * vertex height, and the stack is convex about that height, the nearest
 * contact is that plane's vertex whenever the stack is open — and the closed
 * stack's outer edge when it is shut, which is the truth in that state too.
 */
export function rigFrame(s: RigState): RigFrame {
  const bare = rigQuads(s, false)
  const live = rigQuads(s, true)
  const rows = bare.map(q => leftVertex(q).y)
  const ends = rows.map((y, i) => {
    let best = Number.POSITIVE_INFINITY
    for (const q of live) {
      const x = leftEdgeAt(q, y)
      if (x !== null && x < best) best = x
    }
    return Number.isFinite(best) ? best : leftVertex(bare[i]).x
  })
  return { rows, ends }
}
