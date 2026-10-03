import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { MarkState } from './SurfaceMark'

/**
 * THE SURFACE FIELD — the workspace's centrepiece.
 *
 * The selected application's icon, re-made as a few thousand points in space.
 * It is SurfaceMark's idea (the app drawn from its own artwork, with the mark
 * doing whatever Modable is doing) carried from a flat character grid into a
 * dimensional cloud: points sit on a shallow dome, brightness and the density-
 * ramp glyphs gather on the icon's edges so the silhouette reads first.
 *
 *   arrive      the previous form loosens, disperses a little, shifts to the
 *               new app's colour, reassembles as the new silhouette and
 *               settles with one stabilising pulse
 *   idle        a faint drift and a few degrees of parallax; the pointer
 *               parts the points
 *   inspecting  a cold read-plane passes down through the form
 *   writing     the surface loosens in amber, then a warm front re-seats it
 *   verifying   whatever is loose snaps home and the amber drains out
 *   fault       a red burst outward, then it re-forms
 *
 * One canvas, one rAF loop, typed arrays throughout. Points are drawn in a
 * handful of colour/alpha buckets so fillStyle changes a few dozen times per
 * frame rather than once per point.
 */

const GLYPHS = ':+*%#'
const RES = 150            // raster width of the icon
const TARGET = 6000        // points in the form
const DUST = 220           // points in the surrounding field
const ALPHA_STEPS = 7

/** Seconds: the longest per-point delay, one point's journey, and when the
 *  settle pulse peaks. Together they are the whole arrival. */
const STAGGER = 0.42
const TRAVEL = 0.8
const PULSE_AT = STAGGER + TRAVEL + 0.08

type Rgb = [number, number, number]
const BONE: Rgb = [240, 236, 230]
const XENON: Rgb = [140, 198, 240]
const FILAMENT: Rgb = [255, 180, 84]
const FAULT: Rgb = [214, 69, 94]

type Cloud = {
  n: number
  form: number             // how many of the n are the form; the rest are dust
  hx: Float32Array; hy: Float32Array; hz: Float32Array   // home, in form units
  sx: Float32Array; sy: Float32Array; sz: Float32Array   // where the arrival starts
  mx: Float32Array; my: Float32Array; mz: Float32Array   // the dispersal it passes through
  w: Float32Array          // weight: how much ink the point carries (0..1)
  e: Float32Array          // how much of an edge it sits on (0..1)
  seed: Float32Array
  lag: Float32Array        // arrival delay, seconds
  tint: Uint8Array         // 0 bone, 1 the app's own hue
  glyph: Int8Array         // -1 for a plain point
  dust: Uint8Array
  ox: Float32Array; oy: Float32Array   // pointer displacement, px
  aspect: number
  hue: Rgb
  /** The icon's own dominant accents (up to four), for the stage variant;
   *  `pal` says which one each tinted point carries. */
  palette: Rgb[]
  pal: Uint8Array
}

function rand(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5
    return ((s >>> 0) % 1_000_000) / 1_000_000
  }
}

/** Rasterise the icon and scatter points over its ink, edges first. */
/** Chamfer distance from each masked pixel to the mask's edge (the image
 *  border counts as edge). Used to inflate a flat mark into a volume. */
function chamfer(m: Uint8Array, W: number, H: number) {
  const d = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) d[i] = m[i] ? 1e9 : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x])
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (!d[i]) continue
    d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414)
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x
    if (!d[i]) continue
    d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414)
  }
  return d
}

function buildCloud(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, aspect: number, stage = false): Cloud | null {
  const W = RES, H = Math.max(8, Math.round(RES * aspect))
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  draw(ctx, W, H)
  const { data } = ctx.getImageData(0, 0, W, H)

  const lum = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3] / 255
    lum[i] = a === 0 ? 0 : (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255 * a
  }
  const at = (x: number, y: number) => lum[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))]

  /* Same scoring as SurfaceMark: luminance blended with local contrast, so a
     flat-coloured icon keeps its structure instead of becoming a slab, and an
     icon's own dark ground drops out rather than reading as a haze. Edges are
     kept separately: they get more points, brighter points and the glyphs,
     which is what makes the silhouette legible at a glance. */
  const score = new Float32Array(W * H)
  const edgeAt = new Float32Array(W * H)
  const sat = new Float32Array(W * H)
  let hr = 0, hg = 0, hb = 0, hn = 0
  let total = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (data[i * 4 + 3] < 20) continue
      // a 2px reach so an edge reads as a band a few points wide, not a hairline
      const edge = Math.min(1, (
        Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1)) +
        (Math.abs(at(x + 2, y) - at(x - 2, y)) + Math.abs(at(x, y + 2) - at(x, y - 2))) * 0.5
      ) * 1.7)
      let s = Math.min(1, lum[i] * (0.5 + 0.5 * edge) + edge * 0.45)
      if (s < 0.1 && edge < 0.1) continue
      s = Math.pow(s, 0.8)
      score[i] = s
      edgeAt[i] = edge
      total += s * (0.5 + edge)
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      sat[i] = mx ? (mx - mn) / mx : 0
      if (sat[i] > 0.35 && mx > 70) { hr += r; hg += g; hb += b; hn++ }
    }
  }
  if (!total) return null
  const hue: Rgb = hn ? [hr / hn, hg / hn, hb / hn] : BONE

  /* The palette: saturated ink binned by hue, keeping the bins that carry a
     real share of it. Slack keeps its four colours instead of averaging to
     brown; a one-colour icon gets one entry; a monochrome icon gets none. */
  const BINS = 12
  const binSum = Array.from({ length: BINS }, () => [0, 0, 0, 0])
  const hueBin = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn || 1
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
    if (h < 0) h += 6
    return Math.min(BINS - 1, Math.floor(h / 6 * BINS))
  }
  for (let i = 0; i < W * H; i++) {
    if (!score[i] || sat[i] <= 0.35) continue
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
    if (Math.max(r, g, b) <= 70) continue
    const bs = binSum[hueBin(r, g, b)]
    bs[0] += r; bs[1] += g; bs[2] += b; bs[3]++
  }
  const binOrder = binSum.map((b, k) => [k, b[3]]).filter(b => b[1] > hn * 0.08).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const palette: Rgb[] = binOrder.map(([k]) => { const b = binSum[k]; return [b[0] / b[3], b[1] / b[3], b[2] / b[3]] as Rgb })
  const binToPal = new Map(binOrder.map(([k], j) => [k, j]))
  const palAt = (i: number) => {
    const k = hueBin(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])
    if (binToPal.has(k)) return binToPal.get(k)!
    // nearest kept bin, around the hue circle
    let best = 0, bd = 99
    binOrder.forEach(([bk], j) => { const d = Math.min(Math.abs(bk - k), BINS - Math.abs(bk - k)); if (d < bd) { bd = d; best = j } })
    return best
  }

  const next = rand(0x51f3a9)
  const pts: { x: number; y: number; w: number; e: number; t: number; p: number; z?: number }[] = []
  /* ---- stage: volume, not outline ----
     The icon is split into its body (the tile, the most common colour) and
     its mark (everything that differs from it). Points fill the whole mark,
     inflated by a distance field so thick parts of the mark bulge toward the
     viewer and thin strokes stay shallow; density swells and thins with a
     smooth noise so nothing reads as an even screen. The body becomes a
     sparse, recessed layer behind it. Edges get only a light bonus, and not
     evenly, so the silhouette reads without the form becoming a tracing. */
  if (stage) {
    const bins = new Map<number, number[]>()
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4 + 3] < 200) continue
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
      let e = bins.get(key)
      if (!e) bins.set(key, (e = [0, 0, 0, 0]))
      e[0] += r; e[1] += g; e[2] += b; e[3]++
    }
    let best: number[] | null = null
    bins.forEach(v => { if (!best || v[3] > best[3]) best = v })
    const bb = best as number[] | null
    const body = bb ? [bb[0] / bb[3], bb[1] / bb[3], bb[2] / bb[3]] : [0, 0, 0]
    const mark = new Uint8Array(W * H), bodyM = new Uint8Array(W * H)
    let nMark = 0, nBody = 0
    for (let i = 0; i < W * H; i++) {
      if (data[i * 4 + 3] < 40) continue
      const dr = data[i * 4] - body[0], dg = data[i * 4 + 1] - body[1], db = data[i * 4 + 2] - body[2]
      if (dr * dr + dg * dg + db * db > 70 * 70) { mark[i] = 1; nMark++ } else { bodyM[i] = 1; nBody++ }
    }
    // a single-colour icon is all mark
    if (nMark < (nMark + nBody) * 0.04) {
      for (let i = 0; i < W * H; i++) if (bodyM[i]) { mark[i] = 1; bodyM[i] = 0 }
      nMark += nBody; nBody = 0
    }
    // a dark tile is void, not a haze
    const bodyLum = (0.2126 * body[0] + 0.7152 * body[1] + 0.0722 * body[2]) / 255
    const bodyShown = nBody > 0 && bodyLum > 0.1
    const dist = chamfer(mark, W, H)
    let maxd = 1
    for (let i = 0; i < W * H; i++) if (dist[i] > maxd) maxd = dist[i]
    const distB = bodyShown ? chamfer(bodyM, W, H) : null
    const clump = (x: number, y: number) => 0.5 + 0.25 * (Math.sin(x * 0.061 + 1.7) + Math.sin(y * 0.053 + x * 0.027 + 0.4))
    const satAt = (i: number) => {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
      return mx > 70 && mx ? (mx - mn) / mx : 0
    }

    const markShare = bodyShown ? 0.76 : 0.94
    let wMark = 0, wBody = 0
    const wt = new Float32Array(W * H)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (mark[i]) {
        const h = Math.sqrt(Math.min(1, dist[i] / maxd))
        // the edge gets a real but uneven bonus: enough that negative space
        // (Spotify's arcs, Discord's eyes) stays crisp, never a uniform outline
        wt[i] = (0.5 + 0.5 * h) * (0.55 + 0.9 * clump(x, y)) + (dist[i] < 2.5 ? 0.3 + 0.4 * clump(y, x) : 0)
        wMark += wt[i]
      } else if (bodyShown && bodyM[i]) {
        wt[i] = 0.5 + (distB![i] < 2 ? 0.6 : 0)
        wBody += wt[i]
      }
    }
    // a little more density in the mark, where the form is read
    const perMark = (TARGET * 1.14 * markShare) / Math.max(1, wMark)
    const perBody = bodyShown ? (TARGET * (1 - markShare)) / Math.max(1, wBody) : 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!wt[i]) continue
      const isMark = mark[i] === 1
      let k = wt[i] * (isMark ? perMark : perBody)
      while (k > 0) {
        if (k >= 1 || next() < k) {
          const sa = satAt(i)
          const px = (x + next()) / W * 2 - 1, py = ((y + next()) / H * 2 - 1) * aspect
          if (isMark) {
            const h = Math.sqrt(Math.min(1, dist[i] / maxd))
            const cl = clump(x, y)
            /* a white mark on a coloured tile (Discord) carries the tile's hue as
               sparse embedded accent, so the colour lives inside the volume */
            const t = (sa > 0.35 && next() < 0.3) || (sa <= 0.35 && palette.length && next() < 0.2) ? 1 : 0
            pts.push({
              x: px, y: py,
              // a lens: forward where the mark is thick, with real thickness
              z: -(0.08 + 0.42 * h) + (next() - 0.5) * 0.22 * (0.3 + h),
              w: Math.min(1, 0.36 + 0.46 * h * (0.7 + 0.6 * cl)),
              e: dist[i] < 2 ? 0.3 * cl : 0,
              t, p: t && palette.length ? palAt(i) : 0,
            })
          } else {
            const hb = Math.sqrt(Math.min(1, distB![i] / 30))
            const t = sa > 0.35 && next() < 0.12 ? 1 : 0
            pts.push({
              x: px, y: py,
              z: 0.2 + next() * 0.12 - 0.08 * hb,
              w: 0.12 + next() * 0.1 + (distB![i] < 2 ? 0.14 : 0),
              e: 0,
              t, p: t && palette.length ? palAt(i) : 0,
            })
          }
        }
        k -= 1
      }
    }
    // raster order, so a morph carries the top of one form to the top of the next
    pts.sort((a, b) => a.y - b.y || a.x - b.x)
  }

  const per = TARGET / total
  for (let y = 0; y < H && !stage; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const s = score[i]
      if (!s) continue
      let k = s * (0.5 + edgeAt[i]) * per
      while (k > 0) {
        if (k >= 1 || next() < k) {
          pts.push({
            x: (x + next()) / W * 2 - 1,
            y: ((y + next()) / H * 2 - 1) * aspect,
            w: s,
            e: edgeAt[i],
            t: sat[i] > 0.35 && next() < 0.34 ? 1 : 0,
            p: palette.length && sat[i] > 0.35 ? palAt(i) : 0,
          })
        }
        k -= 1
      }
    }
  }

  const n = pts.length + DUST
  const c: Cloud = {
    n, form: pts.length,
    hx: new Float32Array(n), hy: new Float32Array(n), hz: new Float32Array(n),
    sx: new Float32Array(n), sy: new Float32Array(n), sz: new Float32Array(n),
    mx: new Float32Array(n), my: new Float32Array(n), mz: new Float32Array(n),
    w: new Float32Array(n), e: new Float32Array(n), seed: new Float32Array(n), lag: new Float32Array(n),
    tint: new Uint8Array(n), glyph: new Int8Array(n), dust: new Uint8Array(n),
    ox: new Float32Array(n), oy: new Float32Array(n),
    aspect, hue,
    palette, pal: new Uint8Array(n),
  }

  const onShell = (r: number) => {
    const u = next() * 2 - 1, th = next() * Math.PI * 2, q = Math.sqrt(1 - u * u)
    return [Math.cos(th) * q * r, u * r, Math.sin(th) * q * r]
  }

  pts.forEach((p, i) => {
    // a shallow dome, pushed forward where the ink is heaviest
    const r2 = p.x * p.x + (p.y / aspect) * (p.y / aspect)
    c.hx[i] = p.x
    c.hy[i] = p.y
    c.hz[i] = p.z ?? -Math.sqrt(Math.max(0, 1.1 - r2)) * 0.38 - p.w * 0.12 + (next() - 0.5) * 0.025
    c.w[i] = p.w
    c.e[i] = p.e
    c.tint[i] = p.t
    c.pal[i] = p.p
    c.seed[i] = next()
    // glyphs gather on the edges, where they sharpen the outline
    // the stage keeps glyphs as a rare accent; the workspace keeps its texture
    c.glyph[i] = next() < (stage ? 0.004 : p.e > 0.45 ? 0.085 : 0.012)
      ? Math.min(GLYPHS.length - 1, Math.floor(p.w * GLYPHS.length)) : -1
    // with nothing to morph from, arrive out of a loose ball around the form
    const [a, b, d] = onShell(0.9 + next() * 0.45)
    c.sx[i] = a; c.sy[i] = b; c.sz[i] = d
    /* the new silhouette resolves top to bottom, so some of it is always
       legible — a uniform stagger left the whole form as fog mid-flight */
    c.lag[i] = ((p.y / aspect + 1) / 2) * STAGGER * 0.75 + next() * STAGGER * 0.25
  })

  for (let j = pts.length; j < n; j++) {
    const [a, b, d] = onShell(1.55 + Math.pow(next(), 2) * 0.9)
    c.hx[j] = a; c.hy[j] = b; c.hz[j] = d
    c.sx[j] = a; c.sy[j] = b; c.sz[j] = d
    c.w[j] = 0.12 + next() * 0.25
    c.seed[j] = next()
    c.glyph[j] = -1
    c.dust[j] = 1
  }
  return c
}

/**
 * Start the new form where the old one is standing.
 *
 * Both clouds are laid down in raster order, top row first, so mapping point i
 * to the same fraction of the old form keeps the top of one icon becoming the
 * top of the next: the morph reads as one surface re-forming, not a swap. Each
 * point passes through a dispersal a little way off its straight path, which
 * is what gives the loosen-and-drift before it lands.
 */
function retarget(c: Cloud, from: Cloud | null, stage = false) {
  for (let i = 0; i < c.form; i++) {
    if (from && from.form) {
      const j = Math.min(from.form - 1, Math.floor((i / c.form) * from.form))
      c.sx[i] = from.hx[j]; c.sy[i] = from.hy[j]; c.sz[i] = from.hz[j]
    }
    const s = c.seed[i]
    const ang = s * 6.2832 * 7
    const el = ((s * 13.7) % 1) * 2 - 1
    const q = Math.sqrt(1 - el * el)
    // the stage flows form to form on a gentle curve rather than dispersing
    const spread = stage ? 0.02 + ((s * 5.3) % 1) * 0.05 : 0.07 + ((s * 5.3) % 1) * 0.15
    c.mx[i] = (c.sx[i] + c.hx[i]) / 2 + Math.cos(ang) * q * spread
    c.my[i] = (c.sy[i] + c.hy[i]) / 2 + el * spread
    c.mz[i] = (c.sz[i] + c.hz[i]) / 2 + Math.sin(ang) * q * spread
  }
}

const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const css = (c: Rgb, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`
const smooth = (v: number) => { const x = Math.min(1, Math.max(0, v)); return x * x * (3 - 2 * x) }

export function SurfaceField({
  src, emoji, state, focusRef, variant = 'workspace', className = '',
}: {
  src?: string
  emoji?: string
  state: MarkState
  /** 'stage' is the home screen's hero: the same form with more depth, an
   *  uneven interior and a slow organic undulation. The workspace keeps the
   *  plain, steadier surface its states are read against. */
  variant?: 'workspace' | 'stage'
  /** The element whose box the form should sit in. The canvas itself bleeds
   *  behind the whole stage; only the form is placed. */
  focusRef: React.RefObject<HTMLElement>
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cloud = useRef<Cloud | null>(null)
  const fromHue = useRef<Rgb>(BONE)
  const born = useRef(0)
  const stateRef = useRef<MarkState>(state)
  const since = useRef(performance.now())
  const reduce = useReducedMotion()

  useEffect(() => {
    stateRef.current = state
    since.current = performance.now()
    if (state === 'scanning') born.current = performance.now()
  }, [state])

  /* ---------- raster ---------- */
  useEffect(() => {
    let dead = false
    const done = (c: Cloud | null) => {
      if (dead) return
      const prev = cloud.current
      if (c) {
        retarget(c, prev, variant === 'stage')
        fromHue.current = prev ? prev.hue : c.hue
      }
      cloud.current = c
      born.current = performance.now()
    }
    if (src) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => done(buildCloud(
        (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        img.naturalHeight / Math.max(1, img.naturalWidth),
        variant === 'stage',
      ))
      img.src = src
    } else if (emoji) {
      done(buildCloud((ctx, w, h) => {
        ctx.font = `${Math.round(h * 0.82)}px serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(emoji, w / 2, h / 2)
      }, 1, variant === 'stage'))
    } else {
      done(null)
    }
    return () => { dead = true }
  }, [src, emoji, variant])

  /* ---------- paint ---------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let last = 0
    let dpr = 1
    let cw = 0, ch = 0
    // the form's placement, eased toward the focus box so it glides when the
    // dock below it grows rather than jumping
    const place = { x: 0, y: 0, s: 0 }
    // where the last write was working: a fault that follows lands there
    const faultAt = { x: 0.15, y: 0 }
    const pointer = { x: -1e4, y: -1e4, tx: 0, ty: 0, px: 0, py: 0 }

    const sprites = new Map<string, HTMLCanvasElement>()
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      const r = canvas.getBoundingClientRect()
      cw = r.width; ch = r.height
      canvas.width = Math.round(cw * dpr)
      canvas.height = Math.round(ch * dpr)
      sprites.clear()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      pointer.x = e.clientX - r.left
      pointer.y = e.clientY - r.top
      pointer.tx = (pointer.x / Math.max(1, cw)) * 2 - 1
      pointer.ty = (pointer.y / Math.max(1, ch)) * 2 - 1
    }
    const onLeave = () => { pointer.x = -1e4; pointer.y = -1e4; pointer.tx = 0; pointer.ty = 0 }
    const host = canvas.parentElement
    if (!reduce) {
      host?.addEventListener('pointermove', onMove)
      host?.addEventListener('pointerleave', onLeave)
    }

    /* glyph sprites, one per character per colour */
    const sprite = (g: string, col: Rgb) => {
      const key = g + col.map(v => v | 0).join(',')
      let s = sprites.get(key)
      if (!s) {
        const px = Math.round(10 * dpr)
        s = document.createElement('canvas')
        s.width = px; s.height = px
        const sc = s.getContext('2d')!
        sc.font = `${Math.round(9 * dpr)}px 'Martian Mono', ui-monospace, monospace`
        sc.textAlign = 'center'; sc.textBaseline = 'middle'
        sc.fillStyle = css(col, 1)
        sc.fillText(g, px / 2, px / 2)
        sprites.set(key, s)
      }
      return s
    }

    // bucket index = colour class * ALPHA_STEPS + alpha step; each entry is x, y, size
    // 0 bone, 1 the averaged hue, 2 the state accent, 3.. the stage palette
    const CLASSES = 7
    const buckets: number[][] = Array.from({ length: CLASSES * ALPHA_STEPS }, () => [])
    const bloom: number[] = []
    /* soft round points for the stage — one small radial sprite per colour,
       quantised so a colour transition doesn't mint a sprite every frame */
    const soft = new Map<string, HTMLCanvasElement>()
    const softSprite = (col: Rgb) => {
      const key = col.map(v => (v / 6) | 0).join(',')
      let sp = soft.get(key)
      if (!sp) {
        if (soft.size > 96) soft.clear()
        sp = document.createElement('canvas')
        sp.width = sp.height = 32
        const g = sp.getContext('2d')!
        const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16)
        gr.addColorStop(0, css(col, 1)); gr.addColorStop(0.3, css(col, 0.92))
        gr.addColorStop(0.58, css(col, 0.3)); gr.addColorStop(1, css(col, 0))
        g.fillStyle = gr; g.fillRect(0, 0, 32, 32)
        soft.set(key, sp)
      }
      return sp
    }
    const gx: number[] = [], gy: number[] = [], gi_: number[] = [], ga: number[] = [], gc: number[] = []

    const stage = variant === 'stage'

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const st = stateRef.current
      const c = cloud.current
      const age = reduce ? 99 : (now - born.current) / 1000
      const arriving = age < PULSE_AT + 0.4
      const fps = reduce ? 4 : st === 'idle' && !arriving ? 40 : 60
      if (now - last < 1000 / fps - 1) return
      last = now

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      if (!c) return

      /* where the form goes */
      const focus = focusRef.current?.getBoundingClientRect()
      const box = canvas.getBoundingClientRect()
      const fx = focus ? focus.left - box.left + focus.width / 2 : cw / 2
      const fy = focus ? focus.top - box.top + focus.height / 2 : ch / 2
      const fs = focus ? Math.min(focus.width / 2, focus.height / 2 / c.aspect) * 1.03 : Math.min(cw, ch) * 0.35
      if (!place.s || reduce) { place.x = fx; place.y = fy; place.s = fs }
      else { place.x += (fx - place.x) * 0.08; place.y += (fy - place.y) * 0.08; place.s += (fs - place.s) * 0.08 }

      const t = reduce ? 0 : now / 1000
      const inState = reduce ? 99 : (now - since.current) / 1000

      /* No turn. The form holds a fixed three-quarter pose and only leans a
         few degrees with the pointer — enough parallax to read as dimensional
         without the whole surface swinging about. */
      pointer.px += (pointer.tx - pointer.px) * 0.05
      pointer.py += (pointer.ty - pointer.py) * 0.05
      /* stage: at rest the form drifts through a few degrees on its own, very
         slowly, so its depth layers slide against each other without anyone
         touching it — parallax that never moves the form off its spot */
      const drift = reduce ? 0 : stage ? 1 : 0.55
      const idleY = (Math.sin(t * 0.13) * 0.055 + Math.sin(t * 0.071 + 1.3) * 0.03) * drift
      const idleX = Math.sin(t * 0.17 + 0.6) * 0.03 * drift
      const ay = -0.14 + pointer.px * 0.09 + idleY
      const ax = 0.06 - pointer.py * 0.06 + idleX
      const cay = Math.cos(ay), say = Math.sin(ay), cax = Math.cos(ax), sax = Math.sin(ax)
      const persp = stage ? 2.5 : 2.75

      // arrival: colour moves across mid-flight; one pulse once it has landed
      const hueK = smooth((age - 0.2) / 0.8)
      const hueNow = mix(fromHue.current, c.hue, hueK)
      const settlePulse = reduce ? 0 : Math.exp(-(((age - PULSE_AT) / 0.16) ** 2))
      // the stage form breathes: a slow swell a little over one percent
      const scale = (1 + settlePulse * 0.012) * (stage && !reduce ? 1 + 0.013 * Math.sin(t * 0.55) : 1)

      /* ---------- the states, in form units ----------
         inspecting  the surface gains definition (edges lift, interior
                     recedes) while one narrow cold line reads down it
         writing     a small warm locus travels across the form; points inside
                     it break loose and re-seat behind it, so the change is
                     visibly local rather than the whole surface churning
         verifying   everything loose snaps home fast, the amber drains, and
                     the edges sharpen once
         fault       horizontal slices slip sideways in red for under a
                     second, then hold still; a few red edge points remain */
      const define = st === 'inspecting' ? smooth(inState / 0.5) : 0
      const scanY = (((inState * 0.42) % 1.3) * 2 - 1.05) * c.aspect
      const wPhase = (inState % 1.8) / 1.8
      const lx = -1.1 + wPhase * 2.2
      const ly = Math.sin(wPhase * Math.PI * 2 + 0.6) * 0.32 * c.aspect
      const wRamp = Math.min(1, inState / 0.15)
      // kept inside the form, so a fault that follows is seen on the surface, not its rim
      if (st === 'writing') {
        faultAt.x = Math.max(-0.45, Math.min(0.45, lx))
        faultAt.y = Math.max(-0.4 * c.aspect, Math.min(0.4 * c.aspect, ly))
      }
      const settle = st === 'verifying' ? Math.max(0, 1 - inState / 0.35) : 1
      const pulse = st === 'verifying' ? Math.exp(-(((inState - 0.3) / 0.12) ** 2)) : 0
      const burst = st === 'fault' ? Math.max(0, 1 - inState / 1.1) : 0
      const slip = Math.floor(inState * 14)

      // verify's confirmation: the edges answer in cold blue, once
      const confirm = st === 'verifying' ? Math.exp(-(((inState - 0.38) / 0.22) ** 2)) : 0
      const accent: Rgb =
        st === 'inspecting' ? XENON
          : st === 'writing' ? FILAMENT
            : st === 'verifying' ? mix(FILAMENT, XENON, smooth((inState - 0.04) / 0.22))
              : st === 'fault' ? FAULT : BONE
      const cls: Rgb[] = [BONE, mix(hueNow, BONE, 0.14), accent]
      // stage: each tinted point keeps its own accent from the icon's palette,
      // arriving from the previous form's hue like the single hue does
      const palGlyph: Rgb[] = []
      if (stage) {
        for (let k = 0; k < 4; k++) {
          const pc = c.palette[k] || c.hue
          cls[3 + k] = mix(mix(fromHue.current, pc, hueK), BONE, 0.1)
          palGlyph[k] = mix(mix(fromHue.current, pc, Math.round(hueK * 8) / 8), BONE, 0.18)
        }
      }
      // glyph sprites are cached per colour, so the hue they use steps in eighths
      const glyphHue = mix(mix(fromHue.current, c.hue, Math.round(hueK * 8) / 8), BONE, 0.14)

      for (const b of buckets) b.length = 0
      bloom.length = 0
      let gn = 0

      const dotBase = dpr * (place.s > 260 ? 1.25 : 1.05)
      const R = 84 // pointer radius, px

      for (let i = 0; i < c.n; i++) {
        const seed = c.seed[i]
        const dust = c.dust[i]
        let x = c.hx[i], y = c.hy[i], z = c.hz[i]

        /* arrival: ease in-out along a curve through the dispersal point, so
           the old form first loosens in place, drifts apart, then lands */
        let k = 1
        if (!dust) {
          const k0 = Math.min(1, Math.max(0, (age - c.lag[i]) / TRAVEL))
          k = k0 < 0.5 ? 4 * k0 * k0 * k0 : 1 - Math.pow(-2 * k0 + 2, 3) / 2
          if (k < 1) {
            const v = 1 - k
            x = v * v * c.sx[i] + 2 * k * v * c.mx[i] + k * k * x
            y = v * v * c.sy[i] + 2 * k * v * c.my[i] + k * k * y
            z = v * v * c.sz[i] + 2 * k * v * c.mz[i] + k * k * z
            // the loosen: a small tremor that peaks mid-flight
            const tremor = stage ? 0 : Math.sin(Math.PI * k) * 0.012
            x += Math.sin(t * 13 + seed * 60) * tremor
            y += Math.cos(t * 11 + seed * 47) * tremor
          }
        }

        if (!reduce) {
          // the stage moves as one field (below), not as independent jitter
          const a = dust ? 0.025 : stage ? 0 : 0.004
          x += Math.sin(t * 0.7 + seed * 40) * a
          y += Math.cos(t * 0.55 + seed * 31) * a
          if (dust) {
            // the field drifts on its own, very slowly
            const r = t * 0.03
            const cr = Math.cos(r), sr = Math.sin(r)
            const nx = x * cr - z * sr
            z = x * sr + z * cr; x = nx
          }
        }

        /* Stage only: one living field. Every point is displaced by the same
           slow, smooth flow, so the form breathes and drifts as a single
           surface instead of shimmering point by point. Most of the ambient
           dust is dropped, so nothing strays around the object. */
        if (stage) {
          if (dust) { if (seed > 0.6) continue }
          else if (!reduce) {
            const f = t * 0.3
            x += Math.sin(y * 2.2 + f) * 0.006
            y += Math.sin(x * 1.9 + f * 0.8 + 1.1) * 0.005
            z += Math.sin(x * 1.6 + y * 1.3 + t * 0.26) * 0.05
          }
        }

        let lit = dust ? 0 : settlePulse * (0.25 + c.e[i] * 0.3)
        let cl = dust ? 0 : c.tint[i]
        if (stage && cl === 1 && c.palette.length) cl = 3 + c.pal[i]

        let recede = 1
        if (!dust && k >= 1) {
          if (st === 'inspecting') {
            // definition: edges lift, the interior steps back
            lit = define * c.e[i] * 0.5
            recede = 1 - define * 0.55 * (1 - c.e[i])
            const d = Math.abs(y - scanY)
            if (d < 0.09) {
              const band = 1 - d / 0.09
              lit = Math.max(lit, band * 0.7)
              z -= band * 0.05
              if (band > 0.5) cl = 2
            }
          } else if (st === 'writing') {
            const dx = x - lx, dy = y - ly
            const d = Math.sqrt(dx * dx + dy * dy)
            const r = 0.42
            if (d < r) {
              const amount = (1 - d / r) * (1 - d / r) * wRamp
              const ang = seed * 81.7
              const reach = amount * (0.04 + ((seed * 7.31) % 1) * 0.1)
              x += Math.cos(ang) * reach + Math.sin(t * 21 + seed * 50) * 0.01 * amount
              y += Math.sin(ang) * reach + Math.cos(t * 17 + seed * 43) * 0.01 * amount
              z -= amount * (0.04 + ((seed * 3.7) % 1) * 0.14)
              lit = amount * 0.5
              if (amount > 0.08) cl = 2
            } else {
              // behind the locus, the re-seated trail stays warm for a moment
              const back = lx - x
              if (back > 0 && back < 0.55 && Math.abs(dy) < r) {
                const seam = (1 - back / 0.55) * (1 - Math.abs(dy) / r)
                lit = seam * 0.45
                if (seam > 0.3) cl = 2
              }
            }
          } else if (st === 'verifying') {
            const loose = settle * settle * settle * 0.06
            if (loose > 0.002) {
              const ang = seed * 81.7
              x += Math.cos(ang) * loose * ((seed * 7.31) % 1)
              y += Math.sin(ang) * loose * ((seed * 7.31) % 1)
            }
            lit = settle * 0.15 + pulse * 0.2 * (0.4 + c.e[i]) + confirm * c.e[i] * 0.5
            // residue first (amber, draining), then a sparse blue answer along the edges
            if (seed < 0.35 * settle || (c.e[i] > 0.35 && seed < confirm * 0.8)) cl = 2
          } else if (st === 'fault') {
            const fdx = x - faultAt.x, fdy = y - faultAt.y
            const inRegion = fdx * fdx + fdy * fdy < 0.6 * 0.6
            if (burst > 0 && inRegion) {
              // slices slip sideways and step, never fly apart
              const slice = Math.floor((y / c.aspect + 1) * 7)
              const h = Math.sin(slice * 12.9898 + slip * 78.233) * 43758.5453
              x += ((h - Math.floor(h)) - 0.5) * 0.09 * burst
              lit = burst * 0.3
              if (seed < 0.18 + 0.4 * burst) cl = 2
            } else if (inRegion && c.e[i] > 0.4 && seed < 0.2) {
              cl = 2
            }
          }
        }

        // rotate (y, then x) and project
        const rx = x * cay + z * say
        const rz0 = -x * say + z * cay
        const ry = y * cax - rz0 * sax
        const rz = y * sax + rz0 * cax
        // the ambient dust keeps the gentle perspective; only the form deepens
        const pp = dust ? 3.1 : persp
        const p = pp / (pp + rz)
        const s = place.s * scale * p
        let px = place.x + rx * s
        let py = place.y + ry * s

        // the pointer parts the points
        if (!reduce) {
          const dx = px - pointer.x, dy = py - pointer.y
          const d2 = dx * dx + dy * dy
          let tx = 0, ty = 0
          if (d2 < R * R) {
            const d = Math.sqrt(d2) || 1
            const f = 1 - d / R
            tx = (dx / d) * f * f * 36
            ty = (dy / d) * f * f * 36
          }
          c.ox[i] += (tx - c.ox[i]) * 0.14
          c.oy[i] += (ty - c.oy[i]) * 0.14
          px += c.ox[i]; py += c.oy[i]
        }

        if (px < -20 || py < -20 || px > cw + 20 || py > ch + 20) continue

        /* Brightness lives on the edges: interior ink stays quiet so the
           outline and the icon's key features carry the read. Points in
           flight run a little dimmer, so the landing is what brightens. */
        const depth = Math.min(1.25, Math.max(0.25, p * p))
        /* stage lighting is by depth: the near structure is brightest, the
           recessed body falls away, and brightness follows the mark's volume
           rather than its outline */
        const light = Math.min(1.45, Math.max(0.28, 0.74 + (p - 1) * 2.9))
        /* stage shimmer: a slow diagonal glint sweeps across the form and
           catches a sparse subset of points on the way — one coherent pass
           every few seconds, never independent flicker */
        let glint = 0
        if (stage && !dust && !reduce && ((seed * 3571.3) % 1) < 0.3) {
          const g = Math.sin((x * 0.8 + y) * 2.4 - t * 0.85)
          glint = g > 0 ? g * g * g * g * g * g * g * g * g * g : 0
        }
        let a = stage
          // the ambient field: faint, lit by depth, so it reads as space around the form
          ? (dust ? 0.028 + 0.075 * Math.min(1, Math.max(0, (p - 0.86) / 0.3)) : ((0.1 + c.w[i] * 0.8 + c.e[i] * 0.33) * light + glint * 0.45) * (0.55 + 0.45 * k))
          : dust ? 0.08 : (0.14 + c.w[i] * 0.3 + c.e[i] * 0.78) * Math.pow(depth, 1.6) * (0.55 + 0.45 * k)
        a = Math.min(1, a * recede + lit * 0.45)
        if (a < 0.03) continue

        if (c.glyph[i] >= 0) {
          gx[gn] = px; gy[gn] = py; gi_[gn] = i; ga[gn] = a; gc[gn] = cl
          gn++
          continue
        }
        const step = Math.min(ALPHA_STEPS - 1, Math.floor(a * ALPHA_STEPS))
        const size = stage
          // nearer points are larger, farther ones smaller and softer
          ? dotBase * Math.max(0.5, 0.6 + (p - 0.88) * 1.7) * (1 + glint * 0.35)
          : (dust ? 0.85 : 0.85 + c.e[i] * 0.5) * dotBase * (0.55 + p * 0.6) + (lit > 0.5 ? dpr * 0.5 : 0)
        buckets[cl * ALPHA_STEPS + step].push(px * dpr, py * dpr, size)
        // the nearest, brightest points carry a very faint bloom
        if (stage && !dust && p > 1.16 && a > 0.6) { bloom.push(px * dpr, py * dpr, size, cl) }
      }

      if (stage) {
        for (let ci = 0; ci < CLASSES; ci++) {
          const sp = softSprite(cls[ci])
          for (let s = 0; s < ALPHA_STEPS; s++) {
            const list = buckets[ci * ALPHA_STEPS + s]
            if (!list.length) continue
            ctx.globalAlpha = (s + 0.5) / ALPHA_STEPS
            for (let q = 0; q < list.length; q += 3) {
              const d = list[q + 2] * 1.9
              ctx.drawImage(sp, list[q] - d / 2, list[q + 1] - d / 2, d, d)
            }
          }
        }
        ctx.globalAlpha = 0.06
        for (let q = 0; q < bloom.length; q += 4) {
          const d = bloom[q + 2] * 5.5
          ctx.drawImage(softSprite(cls[bloom[q + 3]]), bloom[q] - d / 2, bloom[q + 1] - d / 2, d, d)
        }
        ctx.globalAlpha = 1
      } else {
        for (let ci = 0; ci < CLASSES; ci++) {
          for (let s = 0; s < ALPHA_STEPS; s++) {
            const list = buckets[ci * ALPHA_STEPS + s]
            if (!list.length) continue
            ctx.fillStyle = css(cls[ci], (s + 0.5) / ALPHA_STEPS)
            for (let q = 0; q < list.length; q += 3) {
              const sz = list[q + 2]
              ctx.fillRect(list[q] - sz / 2, list[q + 1] - sz / 2, sz, sz)
            }
          }
        }
      }

      // glyphs: writing churns them through the ramp, idle lets a few drift
      const half = 5 * dpr
      for (let q = 0; q < gn; q++) {
        const i = gi_[q]
        let g = c.glyph[i]
        if (!reduce) {
          const churn = st === 'writing' && gc[q] === 2 ? 0.5 : 0.004
          if (Math.sin(t * 6 + c.seed[i] * 97) > 1 - churn * 2) g = (g + 1 + (Math.floor(t * 9) % 3)) % GLYPHS.length
        }
        ctx.globalAlpha = ga[q]
        const gcol = gc[q] === 1 ? glyphHue : gc[q] >= 3 ? palGlyph[gc[q] - 3] : cls[gc[q]]
        ctx.drawImage(sprite(GLYPHS[g], gcol), gx[q] * dpr - half, gy[q] * dpr - half)
      }
      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      host?.removeEventListener('pointermove', onMove)
      host?.removeEventListener('pointerleave', onLeave)
    }
  }, [reduce, focusRef, variant])

  return <canvas ref={canvasRef} className={`mw-field ${className}`} data-state={state} aria-hidden="true" />
}
