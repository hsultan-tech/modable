/**
 * SIGNATURE — the layer edge.
 *
 * An edge-on view of an application's layers. The app's own layers sit at the
 * bottom in graphite; every layer Modable has written burns amber on top. The
 * same glyph is drawn 3px wide on a tile and 40px wide on the injection stage,
 * so the product says the same thing at every scale.
 */
export function LayerEdge({
  written,
  reachable = false,
  slots = 6,
  className = '',
  style,
}: {
  written: number
  reachable?: boolean
  slots?: number
  className?: string
  style?: React.CSSProperties
}) {
  const lit = Math.max(0, Math.min(written, slots - 1))
  return (
    <span className={`mdb-edge ${className}`} style={style} aria-hidden="true">
      {Array.from({ length: slots }, (_, i) => {
        // index 0 is the top strip — the most recently deposited layer
        const isWritten = i < lit
        const isSeam = i === lit && reachable
        return <i key={i} className={isWritten ? 'written' : isSeam ? 'reachable' : ''} />
      })}
    </span>
  )
}
