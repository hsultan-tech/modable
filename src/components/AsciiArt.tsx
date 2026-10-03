import { memo, useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/** Density ramp, sparse to solid. */
const RAMP = ' .:-=+*%#'

type Row = { text: string; runs: { text: string; level: number }[] }

/**
 * The target application, drawn from its own icon.
 *
 * The icon is rasterised to a character grid and mapped to a density ramp, so
 * what you see is the real artwork rather than a stored art file. Density comes
 * from how far each pixel sits from the icon's own base tone, which keeps the
 * mark legible instead of flattening a full-bleed icon into a solid block.
 *
 * It writes in a row at a time under a cold read-line — the same gesture the
 * injection sequence uses to inspect a surface.
 */
export const AsciiArt = memo(function AsciiArt({
  src,
  emoji,
  cols = 56,
  warm = false,
  lift = false,
  className = '',
}: {
  src?: string
  emoji?: string
  cols?: number
  warm?: boolean
  /**
   * Raise the whole ramp off the field.
   *
   * The default palette is tuned for the masthead, where the art sits at 56
   * columns against panel ink and the low ramp levels are meant to recede. Used
   * as the subject of a full-field loading beat it is too dark to read, and the
   * low levels — which are most of the marks — never take the warm colour at
   * all. `lift` is the palette for that use: every lit level carries real
   * value, and `warm` warms all of them rather than just the top two.
   */
  lift?: boolean
  className?: string
}) {
  const [rows, setRows] = useState<Row[]>([])
  const reduce = useReducedMotion()

  useEffect(() => {
    let cancelled = false

    const build = (
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
      aspect: number
    ) => {
      // measure the character cell so the art keeps the icon's proportions
      const probe = document.createElement('canvas').getContext('2d')
      if (!probe) return
      probe.font = "32px 'Martian Mono', ui-monospace, monospace"
      const cell = probe.measureText('M').width / 32
      const height = Math.max(8, Math.round(cols * cell * aspect))

      const canvas = document.createElement('canvas')
      canvas.width = cols
      canvas.height = height
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.clearRect(0, 0, cols, height)
      draw(ctx, cols, height)

      const { data } = ctx.getImageData(0, 0, cols, height)
      const lum: number[] = []
      const alpha: number[] = []
      const opaque: number[] = []
      for (let i = 0; i < cols * height; i++) {
        const o = i * 4
        const a = data[o + 3] / 255
        const l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255
        lum.push(l)
        alpha.push(a)
        if (a > 0.5) opaque.push(l)
      }
      // the icon's own base tone, so a white or blurple field reads as ground
      const sorted = [...opaque].sort((a, b) => a - b)
      const base = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0.5
      const spread = sorted.length
        ? Math.max(0.08, Math.max(base - sorted[0], sorted[sorted.length - 1] - base))
        : 1

      // Ground is whatever the icon uses as its own field, so only the mark
      // survives — a full-bleed white or blurple tile reads as empty, the way a
      // logo silhouette does, instead of flattening into a solid rectangle.
      const FLOOR = 0.13
      /* `lift` also biases the ramp, not just the palette. At masthead scale
         the icon's mid tones should sit low on the ramp and recede; as the
         subject of a loading beat the same mapping renders the mark almost
         entirely as `.` and `:`, which is too little ink to read at any
         colour. A shallower gamma pushes those mids up into `=+*%#`. */
      const GAMMA = lift ? 0.45 : 0.72
      const out: Row[] = []
      for (let y = 0; y < height; y++) {
        const levels: number[] = []
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x
          const a = alpha[i]
          if (a < 0.3) { levels.push(0); continue }
          const deviation = Math.min(1, Math.abs(lum[i] - base) / spread)
          const v = a * Math.pow(deviation, GAMMA)
          if (v < FLOOR) { levels.push(0); continue }
          const norm = (v - FLOOR) / (1 - FLOOR)
          levels.push(1 + Math.round(norm * (RAMP.length - 2)))
        }
        while (levels.length && levels[levels.length - 1] === 0) levels.pop()

        const runs: { text: string; level: number }[] = []
        for (const level of levels) {
          const last = runs[runs.length - 1]
          if (last && last.level === level) last.text += RAMP[level]
          else runs.push({ text: RAMP[level], level })
        }
        out.push({ text: levels.map(l => RAMP[l]).join(''), runs })
      }

      // trim the icon's own padding, and the stray specks a drop shadow leaves,
      // so the art sits tight against the masthead beside it
      const ink = (r: Row) => r.text.replace(/ /g, '').length
      let top = 0
      while (top < out.length && ink(out[top]) < 3) top++
      let bottom = out.length
      while (bottom > top && ink(out[bottom - 1]) < 3) bottom--
      const body = out.slice(top, bottom)

      const indent = body.reduce((min, r) => {
        if (!ink(r)) return min
        return Math.min(min, r.text.length - r.text.trimStart().length)
      }, cols)
      const dedented: Row[] = body.map(r => {
        if (!indent) return r
        const text = r.text.slice(indent)
        const runs: { text: string; level: number }[] = []
        let taken = 0
        for (const run of r.runs) {
          const skip = Math.max(0, Math.min(run.text.length, indent - taken))
          taken += run.text.length
          const kept = run.text.slice(skip)
          if (kept) runs.push({ text: kept, level: run.level })
        }
        return { text, runs }
      })

      if (!cancelled) setRows(dedented)
    }

    if (src) {
      const img = new Image()
      img.onload = () => build(
        (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        img.naturalHeight / (img.naturalWidth || 1)
      )
      img.onerror = () => buildEmoji()
      img.src = src
    } else {
      buildEmoji()
    }

    function buildEmoji() {
      build((ctx, w, h) => {
        ctx.font = `${Math.round(h * 0.92)}px serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(emoji || '▣', w / 2, h / 2)
      }, 1)
    }

    return () => { cancelled = true }
  }, [src, emoji, cols, lift])

  if (!rows.length) return <div className={className} aria-hidden="true" />

  const step = 0.024

  /* Five ramps, not one. The masthead pair is the original: the mark reads at
     the top of the ramp and the rest sinks into the panel. The lifted pair is
     for the object as subject — nothing lit is allowed to fall back into the
     field, and warm means the whole mark warms, not its two brightest levels. */
  const COLD = ['#4b453f', '#6b635b', 'var(--fg-2)', 'var(--fg-1)', 'var(--fg-0)']
  const WARM = ['#4b453f', '#6b635b', 'var(--fg-2)', '#c98b3f', 'var(--filament)']
  const COLD_LIFT = ['#8f867c', '#b6ada2', '#d7cfc5', '#f0eae2', '#ffffff']
  const WARM_LIFT = ['#c07f31', '#daa044', '#f0b451', '#ffc46e', '#ffe6bd']

  const ramp = lift ? (warm ? WARM_LIFT : COLD_LIFT) : (warm ? WARM : COLD)
  const tint = (level: number) => {
    if (level >= 8) return ramp[4]
    if (level >= 6) return ramp[3]
    if (level >= 4) return ramp[2]
    if (level >= 2) return ramp[1]
    return ramp[0]
  }

  return (
    <div
      className={`mdb-ascii-wrap relative ${className}`}
      role="img"
      aria-label="The target application, drawn in ASCII"
    >
      <pre className="mdb-ascii">
        {rows.map((row, y) => (
          <motion.div
            key={y}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: y * step, duration: 0.16 }}
          >
            {row.runs.length
              ? row.runs.map((run, i) => (
                  <span key={i} style={{ color: tint(run.level) }}>{run.text}</span>
                ))
              : ' '}
          </motion.div>
        ))}
      </pre>

      {/* the cold read-line that draws it in */}
      {!reduce && (
        <motion.span
          className="absolute left-0 right-0 h-px pointer-events-none"
          style={{ background: 'var(--xenon)', boxShadow: '0 0 14px 2px rgba(207,233,255,0.55)' }}
          initial={{ top: 0, opacity: 0.9 }}
          animate={{ top: '100%', opacity: 0 }}
          transition={{ duration: rows.length * step + 0.16, ease: 'linear' }}
        />
      )}
    </div>
  )
})
