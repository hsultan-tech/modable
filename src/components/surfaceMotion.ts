/**
 * Motion primitives for the Surface.
 *
 * Everything the object does is integrated, never lerped. A lerp toward a
 * target moves fastest at the start and crawls at the end, which is why the
 * previous pass read as "fading between poses" rather than as an object that
 * was pushed. A second-order spring accelerates, overshoots and settles, so a
 * state change has a direction and a cost.
 */

export type Spring = {
  /** current value */
  x: number
  /** current velocity, in units per second */
  v: number
  /** stiffness */
  k: number
  /** damping */
  d: number
}

export function spring(x: number, k: number, d: number): Spring {
  return { x, v: 0, k, d }
}

/**
 * Semi-implicit Euler at a fixed 240Hz substep.
 *
 * Fixed substeps matter: at 24fps readback the frame delta is large enough
 * that integrating it in one go makes a stiff spring diverge, and the object
 * detonates on the first state change.
 */
export function stepSpring(s: Spring, target: number, dt: number): void {
  let remaining = Math.min(dt, 0.1)
  const h = 1 / 240
  while (remaining > 0) {
    const e = remaining > h ? h : remaining
    remaining -= e
    s.v += ((target - s.x) * s.k - s.v * s.d) * e
    s.x += s.v * e
  }
}

/** Kick a spring's velocity — an impulse, as if the object had been struck. */
export function impulse(s: Spring, v: number): void {
  s.v += v
}

/** 6t^5 - 15t^4 + 10t^3 — C2 continuous, so the scan has no visible seam. */
export function smootherstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t
  return c * c * c * (c * (c * 6 - 15) + 10)
}
