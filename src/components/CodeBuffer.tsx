import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export type BufferState = 'drafting' | 'ready' | 'written' | 'empty'

/** Keywords worth lifting out of the body text. Nothing else is special-cased. */
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'new', 'this', 'null', 'undefined', 'true', 'false', 'typeof', 'instanceof',
  'try', 'catch', 'finally', 'throw', 'await', 'async', 'of', 'in', 'delete',
])

const TOKENS = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*$|\b[A-Za-z_$][\w$]*\b)/

/**
 * The layer, as source.
 *
 * Highlighting is achromatic on purpose — structure comes from the graphite
 * ramp, so the only colour on screen stays reserved for reading (xenon) and
 * writing (filament).
 */
function tint(token: string): string {
  if (token.startsWith('//')) return 'var(--fg-3)'
  if (/^["'`]/.test(token)) return 'var(--fg-1)'
  if (KEYWORDS.has(token)) return 'var(--fg-0)'
  return 'var(--fg-2)'
}

function Highlighted({ line }: { line: string }) {
  if (!line) return <>{' '}</>
  const parts = line.split(TOKENS).filter(p => p !== undefined && p !== '')
  return (
    <>
      {parts.map((part, i) =>
        TOKENS.test(part) && (part.startsWith('//') || /^["'`]/.test(part) || KEYWORDS.has(part))
          ? <span key={i} style={{ color: tint(part) }}>{part}</span>
          : <span key={i} style={{ color: 'var(--fg-2)' }}>{part}</span>
      )}
    </>
  )
}

export function CodeBuffer({
  code,
  title,
  state,
  subtitle,
  onClose,
}: {
  code: string
  title: string
  state: BufferState
  subtitle?: string
  /** When given, the header carries a close control. */
  onClose?: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const lines = code ? code.split('\n') : []

  // follow the model as it writes
  useEffect(() => {
    if (state !== 'drafting') return
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [code, state])

  const accent =
    state === 'drafting' ? 'var(--xenon-mid)'
      : state === 'written' ? 'var(--filament)'
        : 'var(--fg-2)'

  return (
    <div className="flex flex-col min-h-0 h-full" style={{ boxShadow: 'inset 1px 0 0 var(--hair)' }}>
      <div className="h-11 shrink-0 flex items-center gap-3 px-5 titlebar-drag">
        <span className="mdb-dot" style={{ background: accent, boxShadow: state === 'empty' ? 'none' : `0 0 7px ${accent}` }} />
        <span className="mdb-mono text-[10px] truncate" style={{ color: state === 'empty' ? 'var(--fg-3)' : 'var(--fg-1)' }}>
          {title}
        </span>
        <span className="ml-auto mdb-label shrink-0" style={{ color: accent }}>
          {state === 'drafting' ? 'writing' : state === 'ready' ? 'ready' : state === 'written' ? subtitle || 'written' : ''}
        </span>
        {onClose && (
          <button onClick={onClose} className="no-drag mdb-buffer-close" title="Close the code panel" aria-label="Close the code panel">
            ×
          </button>
        )}
      </div>

      <div ref={bodyRef} className="flex-1 min-h-0 overflow-auto px-5 pb-6">
        {lines.length ? (
          <pre className="mdb-code">
            {lines.map((line, i) => (
              <div key={i} className="mdb-code-line">
                <span className="mdb-code-no">{i + 1}</span>
                <span className="mdb-code-src">
                  <Highlighted line={line} />
                  {state === 'drafting' && i === lines.length - 1 && (
                    <span className={`mdb-code-caret ${reduce ? '' : 'mdb-blink'}`} />
                  )}
                </span>
              </div>
            ))}
          </pre>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            {state === 'drafting' ? (
              <motion.span
                className="mdb-label"
                animate={reduce ? undefined : { opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.8, repeat: Infinity }}
              >
                Reading the surface
              </motion.span>
            ) : (
              <>
                <span className="mdb-label mb-2.5">No layer drafted</span>
                <p className="text-[11.5px] leading-relaxed max-w-[240px]" style={{ color: 'var(--fg-3)' }}>
                  Describe a change at the prompt. The layer appears here as it is written.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
