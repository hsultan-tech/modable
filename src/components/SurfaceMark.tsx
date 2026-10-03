import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

/**
 * THE SURFACE MARK — Modable's signature object.
 *
 * The selected application drawn from its own icon, rasterised to a density
 * ramp. It is the only animated thing on the index, and what it is doing is
 * always what Modable is doing:
 *
 *   idle        a few characters drift a level, very slowly
 *   scanning    the load-in replays: the surface resolves again
 *   inspecting  crossing waves sharpen crests and thin troughs
 *   writing     a travelling front fragments and rewrites in amber
 *   verifying   everything snaps home and settles to a crisp white form
 *   fault       brief red fragmentation, then back to the stable form
 *
 * Nothing here re-renders React once the artwork is rastered: the paint loop
 * writes each row's text directly, and skips any row whose characters have not
 * changed, so a settled mark costs almost nothing per frame.
 *
 * It resolves rather than appearing: rows fade in top to bottom under a cold
 * read-line, the load-in carried over from AsciiArt.
 *
 * It carries its own rasteriser rather than sharing AsciiArt's: that one emits
 * colour-run spans for static display, this one needs a mutable numeric grid
 * it can disturb per character.
 */

const RAMP = ' .:-=+*%#'
const TOP = RAMP.length - 1

/** Must match .mdb-mark's letter-spacing and line-height. */
const TRACKING = 0.055
const LINE = 1.02

/** Seconds per row of the reveal, and how long one row takes to reconstruct. */
const STEP = 0.024
const BUILD = 0.42

/** 4x4 ordered-dither threshold matrix, normalised to 0..1. */
const BAYER = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map(v => v / 16)

export type MarkState = 'idle' | 'scanning' | 'inspecting' | 'writing' | 'verifying' | 'fault'

/** Frames are cheap but not free; the mark is deliberately unhurried. */
const FPS: Record<MarkState, number> = {
  idle: 6,
  scanning: 20,
  inspecting: 24,
  writing: 20,
  verifying: 24,
  fault: 22,
}

export function SurfaceMark({
  src, emoji, state, cols = 68, className = '',
}: {
  /** The application's own icon. */
  src?: string
  emoji?: string
  state: MarkState
  cols?: number
  className?: string
}) {
  const grid = useRef<{ w: number; h: number; level: Uint8Array; cell: number } | null>(null)
  const pre = useRef<HTMLPreElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [fontPx, setFontPx] = useState(8)
  const revealAt = useRef(0)
  const stateRef = useRef<MarkState>(state)
  const since = useRef<number>(performance.now())
  const reduce = useReducedMotion()

  /* Row count drives the markup; `reveal` re-keys it so a new target plays the
     load-in again rather than swapping in already-resolved artwork. */
  const [shape, setShape] = useState<{ h: number; cell: number; reveal: number }>({ h: 0, cell: 0.6, reveal: 0 })

  stateRef.current = state
  useEffect(() => { since.current = performance.now() }, [state])

  /* A scan is the surface resolving again, so it replays the load-in rather
     than inventing a second vocabulary for the same idea. */
  useEffect(() => {
    if (state === 'scanning') {
      revealAt.current = performance.now()
      setShape(s => (s.h ? { ...s, reveal: s.reveal + 1 } : s))
    }
  }, [state])

  /* ---------- raster ---------- */
  useEffect(() => {
    let dead = false

    const build = (
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
      aspect: number
    ) => {
      const probe = document.createElement('canvas').getContext('2d')
      if (!probe) return
      // measure the cell so the mark keeps the icon's real proportions
      probe.font = "32px 'Martian Mono', ui-monospace, monospace"
      const cell = probe.measureText('M').width / 32
      const h = Math.max(8, Math.round(cols * cell * aspect))

      const cv = document.createElement('canvas')
      cv.width = cols; cv.height = h
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.clearRect(0, 0, cols, h)
      draw(ctx, cols, h)

      const { data } = ctx.getImageData(0, 0, cols, h)
      const lum = new Float32Array(cols * h)
      let lo = 1, hi = 0
      for (let i = 0; i < cols * h; i++) {
        const a = data[i * 4 + 3] / 255
        const l = a === 0 ? 0
          : (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255 * a
        lum[i] = l
        if (a > 0.08) { if (l < lo) lo = l; if (l > hi) hi = l }
      }
      const span = Math.max(0.0001, hi - lo)

      /* Luminance alone turns a flat-coloured icon into a solid slab of '#' —
         at hero size that reads as a block, not as artwork. Blending in local
         contrast hollows out even interiors and keeps edges dense, so the
         form keeps its structure however flat the source art is. */
      const level = new Uint8Array(cols * h)
      const at = (x: number, y: number) =>
        lum[Math.min(h - 1, Math.max(0, y)) * cols + Math.min(cols - 1, Math.max(0, x))]

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          const a = data[i * 4 + 3] / 255
          if (a <= 0.08) { level[i] = 0; continue }

          const gx = Math.abs(at(x + 1, y) - at(x - 1, y))
          const gy = Math.abs(at(x, y + 1) - at(x, y - 1))
          const edge = Math.min(1, (gx + gy) * 2.2)

          const norm = Math.min(1, Math.max(0, (lum[i] - lo) / span))
          let score = Math.min(1, norm * (0.42 + 0.58 * edge) + edge * 0.28)

          /* An icon's own near-black ground is opaque, so it survived the alpha
             test and mapped to the bottom of the ramp — 42% of all ink was '.'
             and the mark had no silhouette, just a rectangular haze. Ground
             with no edge in it is not ink; let it be empty. */
          if (score < 0.17 && edge < 0.13) { level[i] = 0; continue }

          // lift the survivors so the ramp reaches its top, not just its floor
          score = Math.pow(score, 0.86)

          /* A flat region has one score, so it lands on one glyph and reads as
             a band. Ordered dithering spreads it across neighbouring ramp
             levels instead — the same trick halftone uses to render flat tone,
             and deterministic, so a target's artwork never changes. */
          score += (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 0.26 * (1 - edge)

          level[i] = 1 + Math.round(Math.min(1, Math.max(0, score)) * (TOP - 1))
        }
      }

      /* Dropping the ground leaves the corner arcs of a rounded-rect icon as
         isolated cells far from the form — they read as dirt, and they drag
         the crop box out with them. Ink needs company to count as ink. */
      const solid = Uint8Array.from(level)
      /* Two thresholds, because they answer different questions. Rendering at
         >=3 neighbours erases thin strokes and takes the whole mark with it
         (measured: 0 ink, 0x0). But cropping at >=2 keeps the corner pairs,
         and those pairs then ARE the crop box — the form ends up 75% of a
         stage whose outer band is dirt. So: render the 2-neighbour grid, but
         measure the crop from the 3-neighbour core. */
      const core = new Uint8Array(cols * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < cols; x++) {
          if (!solid[y * cols + x]) continue
          let near = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              const ny = y + dy, nx = x + dx
              if (ny < 0 || nx < 0 || ny >= h || nx >= cols) continue
              if (solid[ny * cols + nx]) near++
            }
          }
          if (near < 2) level[y * cols + x] = 0
          else if (near >= 3) core[y * cols + x] = 1
        }
      }

      /* Icons carry transparent margins, which rastered into rows and columns
         of pure blank. Left in, they pad the mark with empty space that reads
         as a gap between the artwork and its metadata. Crop to the ink. */
      let top = 0, bottom = h - 1, left = 0, right = cols - 1
      // bounds come from the core, so stray pairs cannot inflate the box
      const rowBlank = (y: number) => {
        for (let x = 0; x < cols; x++) if (core[y * cols + x]) return false
        return true
      }
      const colBlank = (x: number) => {
        for (let y = 0; y < h; y++) if (core[y * cols + x]) return false
        return true
      }
      while (top < bottom && rowBlank(top)) top++
      while (bottom > top && rowBlank(bottom)) bottom--
      while (left < right && colBlank(left)) left++
      while (right > left && colBlank(right)) right--

      const cw = right - left + 1
      const ch = bottom - top + 1
      const cropped = new Uint8Array(cw * ch)
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          cropped[y * cw + x] = level[(y + top) * cols + (x + left)]
        }
      }

      if (dead) return
      grid.current = { w: cw, h: ch, level: cropped, cell }
      revealAt.current = performance.now()
      setShape(s => ({ h: ch, cell, reveal: s.reveal + 1 }))
    }

    if (src) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => build(
        (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        img.naturalHeight / Math.max(1, img.naturalWidth)
      )
      img.src = src
    } else if (emoji) {
      build((ctx, w, h) => {
        ctx.font = `${Math.round(h * 0.82)}px serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(emoji, w / 2, h / 2)
      }, 1)
    } else {
      grid.current = null
      setShape({ h: 0, cell: 0.6, reveal: 0 })
    }

    return () => { dead = true }
  }, [src, emoji, cols])

  /* ---------- paint ---------- */
  useEffect(() => {
    let raf = 0
    let last = 0
    let prev: string[] = []
    let seed = 0x2f6e2b1

    const rnd = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      return ((seed >>> 0) % 100000) / 100000
    }

    const paint = (now: number) => {
      raf = requestAnimationFrame(paint)
      const g = grid.current
      const kids = pre.current?.children
      if (!g || !kids || kids.length !== g.h) return

      const st = stateRef.current
      if (now - last < 1000 / FPS[st]) return
      last = now

      const t = (now - since.current) / 1000
      const { w, h, level } = g
      const rev = (now - revealAt.current) / 1000
      const building = !reduce && rev < h * STEP + BUILD

      for (let y = 0; y < h; y++) {
        let row = ''
        for (let x = 0; x < w; x++) {
          const base = level[y * w + x]

          if (base === 0) { row += ' '; continue }
          if (reduce) { row += RAMP[base]; continue }

          let lv = base

          /* During the reveal the characters hold their resolved level; the
             load-in itself is AsciiArt's — rows fading in under a cold
             read-line — rather than a second, invented reconstruction. */
          if (building) { row += RAMP[lv]; continue }

          if (st === 'idle') {
            // a handful of characters drift one level; the mark breathes
            if (rnd() < 0.008) lv = Math.max(1, Math.min(TOP, base + (rnd() < 0.5 ? -1 : 1)))

          } else if (st === 'scanning') {
            // the row reveal is the scan; characters hold their resolved level
            // so the progressive resolve reads cleanly underneath it

          } else if (st === 'inspecting') {
            // two crossing waves travel through the mark; characters sharpen
            // where they meet, so the read has direction rather than a scanline
            const wave =
              Math.sin(y * 0.34 - t * 3.1) +
              Math.sin(x * 0.1 - t * 1.6) * 0.62
            /* Crests sharpen and troughs thin. Raising density alone was
               almost invisible: most of the artwork already sits near the top
               of the ramp, so crests clipped and the wave read as the whole
               mark simply getting denser. */
            if (wave > 1.34) lv = Math.min(TOP, base + 2)
            else if (wave > 1.02) lv = Math.min(TOP, base + 1)
            else if (wave < -1.34) lv = Math.max(1, base - 2)
            else if (wave < -1.02) lv = Math.max(1, base - 1)

          } else if (st === 'writing') {
            // the write travels: churn is concentrated in a moving front
            // rather than boiling the whole mark at once
            const front = ((t * 0.5) % 1.2) * (w + 56) - 28
            const d = Math.abs(x - front)
            if (d < 18) { if (rnd() < 0.62) lv = 1 + Math.floor(rnd() * TOP) }
            else if (rnd() < 0.04) lv = Math.max(1, Math.min(TOP, base + (rnd() < 0.5 ? -1 : 1)))

          } else if (st === 'verifying') {
            // everything snaps home over the first half second
            const k = Math.min(1, t / 0.5)
            if (rnd() > k) lv = 1 + Math.floor(rnd() * TOP)

          } else if (st === 'fault') {
            // brief fragmentation, then hold what survived
            if (t < 0.7 && rnd() < 0.3 - t * 0.3) lv = rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * TOP)
          }

          row += RAMP[lv]
        }

        /* Idle disturbs a handful of cells and fault holds still once it has
           settled, so most rows are already on screen. Rewriting one costs a
           text-node rebuild and buys nothing. */
        const el = kids[y] as HTMLElement | undefined
        if (el && prev[y] !== row) {
          el.textContent = row
          prev[y] = row
        }
      }
    }

    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
    /* `shape.reveal` matters: a reveal re-keys the rows, so React hands back
       empty divs while `prev` still holds what the old ones said. Without
       restarting the loop the diff skips those rows and the mark stays blank. */
  }, [reduce, shape.reveal])

  /* Fit the mark to whatever box it is given, rather than a fixed size.
     The advance of one cell is the measured monospace ratio plus the tracking,
     so the grid can be solved for the largest type that still fits both ways —
     which is what lets the artwork be the hero instead of a thumbnail. */
  useEffect(() => {
    const el = box.current
    if (!el || !shape.h) return

    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      const advance = shape.cell + TRACKING
      const byWidth = width / (Math.max(1, grid.current?.w ?? cols) * advance)
      const byHeight = height / (shape.h * LINE)
      setFontPx(Math.max(3, Math.min(byWidth, byHeight)))
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shape.h, shape.cell, cols])

  /* The load-in, restored from AsciiArt: 24ms per row, each row fading over
     160ms, with a cold read-line descending at exactly the same rate. The mark
     resolves under the read-line rather than appearing already finished. */
  const sweep = shape.h * STEP + BUILD

  return (
    <div ref={box} className={`mdb-mark-wrap ${className}`} data-state={state} aria-hidden="true">
      <pre
        ref={pre}
        className="mdb-mark"
        data-state={state}
        key={shape.reveal}
        style={{ fontSize: `${fontPx.toFixed(2)}px` }}
      >
        {Array.from({ length: shape.h }, (_, y) => (
          <div
            key={y}
            className={reduce ? undefined : 'mdb-mark-row'}
            style={reduce ? undefined : { animationDelay: `${(y * STEP).toFixed(3)}s` }}
          />
        ))}
      </pre>

      {/* the cold read-line that draws it in */}
      {!reduce && shape.h > 0 && (
        <span
          key={`line-${shape.reveal}`}
          className="mdb-mark-read"
          style={{
            animationDuration: `${sweep.toFixed(2)}s`,
            '--sweep': `${(shape.h * fontPx * LINE).toFixed(0)}px`,
          } as React.CSSProperties}
        />
      )}
    </div>
  )
}
