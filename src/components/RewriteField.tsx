import { useEffect, useRef } from 'react'

/**
 * The ceiling.
 *
 * One application, drawn plainly, pressed up against a thin amber beam that
 * sits exactly on its top edge. Before Modable has access nothing moves but a
 * caret. Once it does, the beam lifts off the app and the window grows into
 * the space it leaves; then the interface outgrows its original box — a
 * channel column breaks out on the left, a panel unfolds past the right edge,
 * and a new document surface with its own toolbar rises into the headroom
 * that was not there before. The motion itself says what moved; nothing is
 * annotated.
 *
 * Canvas 2D: every rectangle is integrated here, nothing passes through React.
 */

export type FieldPhase = 'idle' | 'auth' | 'scanning' | 'ready' | 'leaving'
export type SurfaceKind = 'slack' | 'discord' | 'notion' | 'spotify' | 'vscode'

/** Which surface structure a discovered app is drawn as. */
export function kindOf(name: string): SurfaceKind {
  const n = name.toLowerCase()
  if (n.includes('slack')) return 'slack'
  if (n.includes('discord')) return 'discord'
  if (n.includes('notion')) return 'notion'
  if (n.includes('spotify')) return 'spotify'
  if (n.includes('code') || n.includes('cursor')) return 'vscode'
  // anything else reads as a document, chat or channel surface — stable by name
  let h = 0
  for (const c of n) h = (h * 31 + c.charCodeAt(0)) | 0
  return (['notion', 'slack', 'discord'] as const)[Math.abs(h) % 3]
}

/* ------------------------------------------------------------------ blocks */

/** One rectangle of interface. Everything about it interpolates. */
type Blk = {
  x: number
  y: number
  w: number
  h: number
  /** warm-white fill alpha */
  f: number
  /** warm-white stroke alpha */
  s: number
  /** corner radius, px */
  r: number
  /** amber edge: the piece being written right now */
  a: number
  /** solid amber fill */
  g: number
  /** opaque surface underneath */
  o: number
  /**
   * Where it opens from when it first appears. ox alone: it unfolds sideways
   * out of that edge. oy alone: it rises out of that line.
   */
  ox?: number
  oy?: number
}

type Style = 'panel' | 'line' | 'lineHi' | 'lineLo' | 'box' | 'card' | 'dot' | 'spark' | 'hl' | 'media'
//                              fill   stroke radius amber  gold  opaque
const ST: Record<Style, [number, number, number, number, number, number]> = {
  panel: [0.03, 0, 3, 0, 0, 0],
  line: [0.15, 0, 1.5, 0, 0, 0],
  lineHi: [0.3, 0, 2, 0, 0, 0],
  lineLo: [0.075, 0, 1.5, 0, 0, 0],
  box: [0.012, 0.11, 4, 0, 0, 0],
  card: [0.025, 0.15, 7, 0, 0, 1],
  dot: [0.15, 0, 99, 0, 0, 0],
  spark: [0, 0, 99, 0, 0.95, 0],
  hl: [0.055, 0, 4, 0, 0, 0],
  media: [0.06, 0, 5, 0, 0, 0],
}

const ghost = (x: number, y: number): Blk => ({ x, y, w: 0, h: 0, f: 0, s: 0, r: 0, a: 0, g: 0, o: 0 })
const isGhost = (b: Blk) => b.w < 0.5 && b.h < 0.5

/** The empty state a new block opens from: an edge, a line, or a point. */
const emerge = (b: Blk): Blk => {
  const g = ghost(b.x + b.w / 2, b.y + b.h / 2)
  if (b.ox !== undefined && b.oy === undefined) return { ...g, x: b.ox, y: b.y, h: b.h, r: b.r }
  if (b.oy !== undefined && b.ox === undefined) return { ...g, x: b.x, y: b.oy, w: b.w, r: b.r }
  if (b.ox !== undefined && b.oy !== undefined) return { ...g, x: b.ox, y: b.oy }
  return g
}

/** Block slots. Fixed ranges, so the same piece of interface keeps its identity. */
const BASE_N = 23
/** Carries the ceiling, so it moves on the same clock as everything it holds. */
const CEIL = 23
const PIECE0 = 24
const PIECE_N = 20
const PIECES = 3
const POOL = PIECE0 + PIECE_N * PIECES
/** Titlebar height at scale 1. */
const TB = 18
/** How far the ceiling can lift, as a share of the app's height. */
const LIFT = 0.3

type Shape = {
  /** 0 = pressed against the ceiling, 1 = fully lifted */
  lift: number
  /** how many of the three pieces have broken out */
  pieces: number
  /** the piece being written right now carries the amber edge */
  newest: number
  /** a line of the conversation, so the app is not a still life */
  typing: 0 | 1
}

/**
 * The application, in px about the centre of its original box. The box never
 * moves: the ceiling lifts off its top, the window grows up after it, and the
 * three pieces stand where the original box could not hold them.
 */
function build(sh: Shape, W: number, H: number, s: number): (Blk | null)[] {
  const out: (Blk | null)[] = new Array(POOL).fill(null)
  const x0 = -W / 2
  const y0 = -H / 2
  const tb = TB * s
  const L = sh.lift * H * LIFT
  const top = y0 + tb
  const ch = H - tb

  const put = (i: number, x: number, y: number, w: number, h: number, st: Style, ox?: number, oy?: number) => {
    const [f, sk, r, a, g, o] = ST[st]
    out[i] = { x, y, w, h, f, s: sk, r: Math.max(0, Math.min(r * s, w / 2, h / 2)), a, g, o, ox, oy }
  }

  // the window: at rest its top edge IS the ceiling
  out[0] = { x: x0, y: y0 - L, w: W, h: H + L, f: 0, s: 0.13, r: 9 * s, a: 0, g: 0, o: 1 }
  // the ceiling itself: it clears the window by a little once lifted, so the
  // app is visibly no longer pressed, and it spans wider the higher it goes
  const ext = (0.14 + 0.17 * sh.lift) * W
  out[CEIL] = { x: x0 - ext, y: y0 - L - 12 * s * sh.lift, w: W + ext * 2, h: 1, f: 0, s: 0, r: 0, a: 0, g: 0, o: 0 }

  // --- the application as it shipped ---------------------------------------
  // the sidebar takes every bit of height it is given
  put(1, x0, top - L, 0.22 * W, ch + L, 'panel')
  put(2, x0 + 0.04 * W, top - L + 12 * s, 0.11 * W, 4 * s, 'lineHi')
  ;[0.13, 0.1, 0.15, 0.09, 0.12, 0.11].forEach((w, i) =>
    put(3 + i, x0 + 0.05 * W, top + 0.15 * ch + i * 0.088 * ch, w * W, 3 * s, i === 2 ? 'line' : 'lineLo'),
  )
  // pressed right up under the ceiling
  put(9, x0 + 0.27 * W, top + 9 * s, 0.17 * W, 4 * s, 'line')
  const widths = [0.42, 0.34, 0.5, sh.typing ? 0.38 : 0.26]
  widths.forEach((w, i) => {
    const y = top + 0.2 * ch + i * 0.16 * ch
    put(10 + i * 3, x0 + 0.27 * W, y, 11 * s, 11 * s, 'dot')
    put(11 + i * 3, x0 + 0.31 * W, y + 1 * s, 0.1 * W, 3 * s, 'line')
    put(12 + i * 3, x0 + 0.31 * W, y + 0.065 * ch, w * W, 3 * s, 'lineLo')
  })
  put(22, x0 + 0.27 * W, top + 0.84 * ch, 0.69 * W, 0.11 * ch, 'box')

  // --- what the original box could not hold ----------------------------------
  const gap = 18 * s
  for (let j = 0; j < Math.min(sh.pieces, PIECES); j++) {
    const b = PIECE0 + j * PIECE_N
    let n = 1
    const at = (x: number, y: number, w: number, h: number, st: Style, ox?: number, oy?: number) =>
      n < PIECE_N && put(b + n++, x, y, w, h, st, ox, oy)

    if (j === 0) {
      // a channel column breaks out on the left, unfolding out of the frame
      const R = { x: x0 - gap - 0.27 * W, y: y0 - 0.45 * L + 4 * s, w: 0.27 * W, h: 0.92 * H + 0.45 * L - 4 * s }
      const ox = x0
      put(b, R.x, R.y, R.w, R.h, 'card', ox)
      const px = R.x + 0.1 * R.w
      at(px, R.y + 16 * s, 0.46 * R.w, 4 * s, 'lineHi', ox)
      at(R.x + 0.08 * R.w, R.y + 34 * s, 0.84 * R.w, 20 * s, 'box', ox)
      ;[0.5, 0.62, 0.44, 0.56, 0.38, 0.5].forEach((w, i) => {
        const y = R.y + 74 * s + i * 27 * s
        if (y > R.y + R.h - 52 * s) return
        if (i === 1) at(R.x + 0.05 * R.w, y - 7 * s, 0.9 * R.w, 20 * s, 'hl', ox)
        at(px, y, 6 * s, 6 * s, 'dot', ox)
        at(px + 13 * s, y + 1.5 * s, w * R.w * 0.8, 3 * s, i === 1 ? 'line' : 'lineLo', ox)
      })
      at(px, R.y + R.h - 28 * s, 13 * s, 13 * s, 'dot', ox)
      at(px + 20 * s, R.y + R.h - 23 * s, 0.4 * R.w, 3 * s, 'lineLo', ox)
    } else if (j === 1) {
      // a media panel unfolds past the right edge
      const R = { x: x0 + W + gap, y: y0 - 0.3 * L + 4 * s, w: 0.3 * W, h: 0.72 * H + 0.3 * L - 4 * s }
      const ox = x0 + W
      put(b, R.x, R.y, R.w, R.h, 'card', ox)
      const ix = R.x + 0.08 * R.w
      const iw = 0.84 * R.w
      at(ix, R.y + 16 * s, 0.42 * R.w, 4 * s, 'lineHi', ox)
      const heroH = 0.36 * R.h
      at(ix, R.y + 34 * s, iw, heroH, 'media', ox)
      const ty = R.y + 34 * s + heroH + 12 * s
      const tw = (iw - 16 * s) / 3
      for (let t = 0; t < 3; t++) at(ix + t * (tw + 8 * s), ty, tw, 0.19 * R.h, 'box', ox)
      const py = R.y + R.h - 34 * s
      at(ix, py, iw, 2 * s, 'lineLo', ox)
      at(ix, py, iw * 0.34, 2 * s, 'line', ox)
      at(R.x + R.w / 2 - 6 * s, py + 9 * s, 12 * s, 12 * s, 'dot', ox)
    } else {
      // a new document surface, with its own toolbar, rises into the headroom
      const R = { x: x0 + 0.25 * W, y: y0 - L + tb + 12 * s, w: 0.71 * W, h: L - tb - 22 * s }
      if (R.h < 56 * s) continue
      const oy = y0
      put(b, R.x, R.y, R.w, R.h, 'card', undefined, oy)
      for (let c = 0; c < 4; c++) at(R.x + 12 * s + c * 38 * s, R.y + 11 * s, 32 * s, 15 * s, 'box', undefined, oy)
      // the control that did not exist before, live
      at(R.x + 18 * s, R.y + 15.5 * s, 6 * s, 6 * s, 'spark', undefined, oy)
      at(R.x + 12 * s, R.y + 40 * s, 0.3 * R.w, 6 * s, 'lineHi', undefined, oy)
      at(R.x + 12 * s, R.y + 55 * s, 0.5 * R.w, 3 * s, 'lineLo', undefined, oy)
      at(R.x + 12 * s, R.y + 65 * s, 0.42 * R.w, 3 * s, 'lineLo', undefined, oy)
      at(R.x + 0.66 * R.w, R.y + 11 * s, 0.31 * R.w, R.h - 22 * s, 'media', undefined, oy)
    }
    if (j === sh.newest) out[b]!.a = 1
  }

  return out
}

/** Which reveal step brings out each piece: first, middle, last. */
function piecesAt(n: number, total: number): number {
  const K = Math.max(1, total)
  const thresholds = K >= 3 ? [1, Math.ceil((K + 1) / 2), K] : K === 2 ? [1, 2] : [1]
  return thresholds.filter(t => n >= t).length
}

/* ------------------------------------------------------------------ engine */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const hash = (i: number) => {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function createEngine(canvas: HTMLCanvasElement, reduce: boolean) {
  const ctx = canvas.getContext('2d')!
  let vw = 0
  let vh = 0
  let dpr = 1
  let s = 1
  let W = 760
  let H = 392
  let raf = 0
  let last = performance.now()
  const born = last

  let phase: FieldPhase = 'idle'
  let kinds: SurfaceKind[] = []
  let total = 0
  let shape: Shape = { lift: 0, pieces: 0, newest: -1, typing: 0 }

  let cur: Blk[] = []
  let from: Blk[] = []
  let to: Blk[] = []
  let delay: number[] = []
  let t0 = -1e9
  let dur = 0
  /** A retarget mid-flight must keep moving, not restart a slow ease-in. */
  let carry = false

  let tight = 1
  let lit = 0
  let leaveAt = 0
  let nextType = born + 4200
  let nextGlint = born + 2600
  /** dir 0 sweeps the beam end to end; ±1 runs out from the centre */
  let glints: { t0: number; dur: number; dir: number; strength: number }[] = []

  const target = (sh: Shape) => build(sh, W, H, s)

  const snap = () => {
    const t = target(shape).map(b => b ?? ghost(0, 0))
    cur = t.map(b => ({ ...b }))
    from = t
    to = t
    delay = t.map(() => 0)
    t0 = -1e9
  }

  /** Rewrite the surface toward a new shape. Retargets smoothly mid-flight. */
  const go = (sh: Shape, now: number, d: number) => {
    shape = sh
    const t = target(sh)
    const f = cur.map(b => ({ ...b }))
    const next: Blk[] = []
    for (let i = 0; i < POOL; i++) {
      const b = t[i]
      if (b) {
        next[i] = b
        // a piece that is new opens out of the edge or line it came from
        if (isGhost(f[i])) f[i] = emerge(b)
      } else {
        next[i] = ghost(f[i].x + f[i].w / 2, f[i].y + f[i].h / 2)
      }
    }
    carry = dur > 0 && now - t0 < dur
    const fr = next[0]
    delay = next.map((b, i) =>
      i === 0 ? 0 : carry ? hash(i) * 0.06 : clamp01((fr.y + fr.h - (b.y + b.h / 2)) / fr.h) * 0.22 + hash(i) * 0.1,
    )
    from = f
    to = next
    t0 = now
    dur = reduce ? 0 : d
  }

  const isRigid = (i: number) => i <= 2 || i === CEIL || (i >= PIECE0 && (i - PIECE0) % PIECE_N === 0)

  const sample = (now: number) => {
    const p = dur > 0 ? (now - t0) / dur : 1
    for (let i = 0; i < POOL; i++) {
      const A = from[i]
      const B = to[i]
      const c = cur[i]
      // the ceiling leads; the window and sidebar follow a beat behind it, so
      // the beam is seen to come off the app before the app grows after it.
      // Pieces' outer cards move rigidly; only what they hold thins in transit.
      const rigid = isRigid(i)
      const lag = i === CEIL ? 0 : i <= 2 ? (carry ? 0.05 : 0.14) : 0
      const q = rigid ? clamp01((p - lag) / (1 - lag)) : clamp01((p - delay[i]) / 0.68)
      const e = p >= 1 ? 1 : carry ? 1 - Math.pow(1 - q, 3) : ease(q)
      const k = rigid ? 0 : Math.sin(Math.PI * e)
      c.x = lerp(A.x, B.x, e)
      c.y = lerp(A.y, B.y, e)
      c.w = lerp(A.w, B.w, e)
      const h = lerp(A.h, B.h, e)
      c.h = rigid ? h : Math.max(h * (1 - 0.5 * k), Math.min(h, 1))
      c.r = lerp(A.r, B.r, e)
      c.a = lerp(A.a, B.a, e)
      c.g = lerp(A.g, B.g, e)
      c.o = lerp(A.o, B.o, e)
      c.f = lerp(A.f, B.f, e) * (1 - 0.35 * k)
      c.s = lerp(A.s, B.s, e) + k * 0.1
    }
  }

  const resize = () => {
    const r = canvas.getBoundingClientRect()
    vw = Math.max(1, r.width)
    vh = Math.max(1, r.height)
    dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(vw * dpr)
    canvas.height = Math.round(vh * dpr)
    s = Math.max(0.6, Math.min(1.25, Math.min(vw / 1440, vh / 900)))
    W = 760 * s
    H = 392 * s
    snap()
    kick()
  }

  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath()
    ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r, w / 2, h / 2)))
  }

  const drawBlock = (b: Blk, px: number) => {
    if (b.w < 0.6 || b.h < 0.6) return
    rr(b.x, b.y, b.w, b.h, b.r)
    if (b.o > 0.01) {
      ctx.fillStyle = `rgba(17,16,15,${b.o})`
      ctx.fill()
    }
    if (b.f > 0.003) {
      ctx.fillStyle = `rgba(240,236,230,${b.f})`
      ctx.fill()
    }
    if (b.g > 0.01) {
      ctx.fillStyle = `rgba(255,180,84,${b.g})`
      ctx.fill()
    }
    if (b.s > 0.004 || b.a > 0.01) {
      ctx.lineWidth = px
      ctx.strokeStyle = b.a > 0.01 ? `rgba(255,180,84,${0.6 * b.a + b.s * (1 - b.a)})` : `rgba(240,236,230,${b.s})`
      ctx.stroke()
    }
  }

  /** The beam. Amber, one pixel, fading out just past what it holds down. */
  const drawCeiling = (y: number, a0: number, a1: number, alpha: number, glow: number, reach: number) => {
    const mid = (a0 + a1) / 2
    const half = ((a1 - a0) / 2) * reach
    if (half < 1) return
    const l = mid - half
    const r = mid + half
    const grad = ctx.createLinearGradient(l, 0, r, 0)
    grad.addColorStop(0, 'rgba(255,180,84,0)')
    grad.addColorStop(0.12, 'rgba(255,180,84,1)')
    grad.addColorStop(0.88, 'rgba(255,180,84,1)')
    grad.addColorStop(1, 'rgba(255,180,84,0)')
    ctx.fillStyle = grad
    ctx.globalAlpha = alpha
    ctx.fillRect(l, y - 0.5, r - l, 1)
    if (glow > 0.01) {
      // light falling from the beam, never a bloom
      ctx.globalAlpha = 0.06 * glow
      ctx.fillRect(l, y - 3, r - l, 6)
    }
    ctx.globalAlpha = 1
  }

  const drawGlint = (y: number, x: number, strength: number) => {
    const g = ctx.createLinearGradient(x - 70, 0, x + 70, 0)
    g.addColorStop(0, 'rgba(255,220,168,0)')
    g.addColorStop(0.5, `rgba(255,226,184,${strength})`)
    g.addColorStop(1, 'rgba(255,220,168,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - 70, y - 0.75, 140, 1.5)
  }

  const frame = (now: number) => {
    raf = 0
    const dt = Math.min(64, now - last)
    last = now

    if (phase === 'idle' && !reduce) {
      // the app is alive, just constrained: one line of it changes, rarely
      if (now >= nextType) {
        go({ ...shape, typing: shape.typing ? 0 : 1 }, now, 1100)
        nextType = now + 4200 + hash(now) * 2400
      }
      if (now >= nextGlint) {
        glints.push({ t0: now, dur: 2400, dir: 0, strength: 0.5 })
        nextGlint = now + 6200 + hash(now + 1) * 2600
      }
    }

    const sm = (tau: number) => (reduce ? 1 : 1 - Math.exp(-dt / tau))
    tight += ((phase === 'auth' ? 0.982 : 1) - tight) * sm(140)
    const litT = phase === 'idle' ? 0 : phase === 'auth' ? 1 : 0.6
    lit += (litT - lit) * sm(160)
    sample(now)

    const cx = vw / 2
    const baseY = vh * 0.635 - H / 2 // centre of the original box
    const intro = reduce ? 1 : ease(clamp01((now - born) / 1200))
    const reach = reduce ? 1 : ease(clamp01((now - born - 250) / 1300))
    const lv = phase === 'leaving' ? ease(clamp01((now - leaveAt) / 600)) : 0
    const g = intro * (1 - lv)
    const k = tight * (1 - 0.05 * lv)
    const content = phase === 'idle' ? 0.88 : 1

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, vw, vh)
    if (g < 0.003) return kick()

    ctx.save()
    ctx.translate(cx, baseY)
    ctx.scale(k, k)
    const px = 1 / k
    const x0 = -W / 2
    const y0 = -H / 2
    const fr = cur[0]
    const L = Math.max(0, y0 - fr.y)

    // the window
    ctx.globalAlpha = g * content
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 52 * s
    ctx.shadowOffsetY = 20 * s
    rr(fr.x, fr.y, fr.w, fr.h, fr.r)
    ctx.fillStyle = '#100f0e'
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.lineWidth = px
    ctx.strokeStyle = `rgba(240,236,230,${fr.s})`
    ctx.stroke()
    ctx.fillStyle = 'rgba(240,236,230,0.13)'
    for (let j = 0; j < 3; j++) {
      ctx.beginPath()
      ctx.arc(fr.x + 12 * s + j * 8 * s, fr.y + 9.5 * s, 2.2 * s, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(240,236,230,0.05)'
    ctx.fillRect(fr.x, fr.y + TB * s, fr.w, px)

    // the app as it shipped
    for (let i = 1; i < BASE_N; i++) drawBlock(cur[i], px)

    // the caret: the app is running, it is just held down
    if (phase === 'idle' && !reduce) {
      const on = Math.sin(now / 170) > -0.2 ? 1 : 0
      ctx.fillStyle = `rgba(240,236,230,${0.45 * on})`
      const cb = cur[22]
      ctx.fillRect(cb.x + 12 * s, cb.y + cb.h / 2 - 5 * s, px * 1.2, 10 * s)
    }

    // a faint trace of where the ceiling used to be, across the app only
    if (L > 2) {
      ctx.globalAlpha = clamp01(L / (30 * s)) * g * content
      ctx.strokeStyle = 'rgba(240,236,230,0.07)'
      ctx.setLineDash([2 * s, 5 * s])
      ctx.beginPath()
      ctx.moveTo(x0 + 0.22 * W, y0)
      ctx.lineTo(x0 + W, y0)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // what the original box could not hold
    ctx.globalAlpha = g
    for (let i = PIECE0; i < POOL; i++) drawBlock(cur[i], px)

    // the ceiling, on top of everything it holds down
    const cb = cur[CEIL]
    drawCeiling(cb.y, cb.x, cb.x + cb.w, (0.7 + 0.28 * lit) * g, lit, reach)
    glints = glints.filter(gl => now - gl.t0 < gl.dur)
    for (const gl of glints) {
      const t = (now - gl.t0) / gl.dur
      const env = Math.sin(Math.PI * t)
      const xx = gl.dir === 0 ? lerp(cb.x + 40 * s, cb.x + cb.w - 40 * s, ease(t)) : gl.dir * ease(t) * (cb.w / 2 - 30 * s)
      ctx.globalAlpha = g
      drawGlint(cb.y, xx, gl.strength * env)
    }
    ctx.globalAlpha = 1
    ctx.restore()

    const busy = dur > 0 && now - t0 < dur
    const leavingLive = phase === 'leaving' && now - leaveAt < 650
    if (!reduce || busy || leavingLive || Math.abs(tight - (phase === 'auth' ? 0.982 : 1)) > 0.001) kick()
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(frame)
  }

  /** The shape the surface should hold for where the sequence is. */
  const shapeFor = (): Shape => {
    if (phase === 'ready' || phase === 'leaving')
      return { lift: 1, pieces: Math.min(PIECES, kinds.length), newest: -1, typing: 0 }
    if (phase === 'scanning') {
      const n = kinds.length
      const K = Math.max(1, total)
      const p = piecesAt(n, total)
      return { lift: 0.25 + 0.75 * clamp01(n / K), pieces: p, newest: p - 1, typing: 0 }
    }
    return { lift: 0, pieces: 0, newest: -1, typing: shape.typing }
  }

  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  resize()

  return {
    setPhase(next: FieldPhase) {
      if (next === phase) return
      const now = performance.now()
      phase = next
      if (next === 'auth') {
        // the beam lights and one pulse runs out along it from the centre
        glints = reduce
          ? []
          : [
              { t0: now, dur: 700, dir: 1, strength: 0.9 },
              { t0: now, dur: 700, dir: -1, strength: 0.9 },
            ]
        go({ ...shape, typing: 0 }, now, 400)
      } else if (next === 'scanning') {
        go(shapeFor(), now, 800)
      } else if (next === 'ready') {
        go(shapeFor(), now, 620)
      } else if (next === 'leaving') {
        leaveAt = now
      }
      kick()
    },
    setScan(nextKinds: SurfaceKind[], nextTotal: number) {
      const grew = nextKinds.length !== kinds.length || nextTotal !== total
      kinds = nextKinds.slice()
      total = nextTotal
      // the reveal and the move to ready can land in the same render
      if (grew && phase !== 'idle' && phase !== 'auth') go(shapeFor(), performance.now(), phase === 'scanning' ? 680 : 620)
      kick()
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
    },
  }
}

/* --------------------------------------------------------------- component */

export function RewriteField({
  phase,
  kinds,
  total,
  reduce,
  className = '',
}: {
  phase: FieldPhase
  /** Surfaces discovery has actually returned, in reveal order. */
  kinds: SurfaceKind[]
  /** How many surfaces the scan will reveal in all, once discovery has landed. */
  total: number
  reduce: boolean
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const engine = useRef<ReturnType<typeof createEngine>>()
  const state = useRef({ phase, kinds, total })
  state.current = { phase, kinds, total }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const e = createEngine(el, reduce)
    e.setScan(state.current.kinds, state.current.total)
    e.setPhase(state.current.phase)
    engine.current = e
    return () => e.destroy()
  }, [reduce])

  // what was found lands before where the sequence is, so a batched render
  // that carries both never builds the ready shape without its surfaces
  useEffect(() => engine.current?.setScan(kinds, total), [kinds, total])
  useEffect(() => engine.current?.setPhase(phase), [phase])

  return <canvas ref={ref} className={`onb-field ${className}`} aria-hidden="true" />
}
