import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Spring, impulse, smootherstep, spring, stepSpring } from './surfaceMotion'

export type SurfaceState = 'idle' | 'connecting' | 'inspecting' | 'rewriting' | 'success'

/**
 * The character grid the scene is rendered onto.
 *
 * The reference renders a lit 3D solid through a luminance ramp onto a
 * character grid — the second bright lobe on the far side of the ring is the
 * tell that it is real geometry and not a 2D effect. Modable already speaks
 * this language, since every app icon in the product is drawn through a density
 * ramp, so the hero is that same renderer pointed at an actual mesh.
 */
const COLS = 96
const ROWS = 54

/** Dense to sparse, read off the reference frame at native resolution. */
const RAMP = ' .,-~:;=!*#$@'

/** 24fps: this is a terminal readout, not a game. */
const FRAME_MS = 1000 / 24

/**
 * Torus proportions taken off the reference rather than guessed. The old
 * 1.05/0.42 left a hole 41% of the outer diameter and the object read as a
 * wire hoop; the reference's hole is closer to 28%, which is what gives it the
 * mass that makes the tumble legible.
 */
const MAJOR_R = 1.0
const MINOR_R = 0.48

/** Per-state targets. Springs are pulled toward these, never snapped. */
const TARGETS: Record<SurfaceState, { spin: number; breath: number; scan: number; split: number }> = {
  idle: { spin: 1.0, breath: 0.62, scan: 0, split: 0 },
  connecting: { spin: 1.75, breath: 0.85, scan: 0, split: 0 },
  inspecting: { spin: 0.95, breath: 0.5, scan: 1, split: 0 },
  rewriting: { spin: 0.6, breath: 0.95, scan: 0, split: 1 },
  success: { spin: 0.82, breath: 0.18, scan: 0, split: 0 },
}

const VERT = /* glsl */ `
  #define TAU 6.28318530718
  #define PI  3.14159265359

  uniform float uTime;
  uniform float uBreath;
  uniform float uSplit;
  uniform float uJolt;

  varying vec3  vNormal;
  varying vec3  vView;
  varying vec3  vWorld;
  varying float vPeel;
  varying float vOuter;

  /* Cheap value noise — enough that the surface breathes instead of pulsing on
     a sine, and far cheaper than simplex across ~6k verts. */
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z) * 2.0 - 1.0;
  }

  void main() {
    vec3 pos = position;

    /* --- the object's own frame -------------------------------------------
       torusGeometry lies in XY with its axis on Z, so the ring direction is
       the XY projection and the surface normal IS the tube normal. Knowing
       which half of the tube faces out is what lets the rewrite lift a skin
       rather than cut slices. */
    vec3 ringDir = normalize(vec3(position.xy, 0.0) + vec3(1e-6, 0.0, 0.0));
    float outer  = dot(normal, ringDir);            // +1 outer equator, -1 in the hole
    float u      = (atan(position.y, position.x) + PI) / TAU;   // 0..1 around the ring

    /* --- breathing ---------------------------------------------------------
       Two octaves in the object's own material space, so the relief sticks to
       the surface as it tumbles instead of swimming across the screen. The
       amplitude is deliberately readable: at 0.185 against a 0.56 tube it is
       ~33% of the section, which is the difference between "organic" and
       "technically present". */
    float n1 = noise(position * 1.15 + vec3(0.0, 0.0, uTime * 0.22));
    float n2 = noise(position * 2.90 - vec3(0.0, 0.0, uTime * 0.38)) * 0.45;
    float nz = (n1 + n2) / 1.45;
    pos += normal * nz * (0.185 * uBreath + 0.10 * uJolt);

    /* --- rewrite: the skin is lifted off the substrate ----------------------
       A front travels around the ring. Ahead of it the outward-facing half of
       the tube peels away along its own normal, dragged along the tangent so
       it fans instead of floating. The inner half stays put and is what you
       then see underneath. That is the product's claim made geometric: a
       surface gets lifted, and there is something under it. */
    // the front keeps breathing once it is open, so the skin is held rather
    // than parked — a peeled sheet under tension, not a finished animation
    float progress = uSplit * 1.72 - 0.34 + sin(uTime * 0.85) * 0.09 * uSplit;
    float peel     = smoothstep(u, u + 0.38, progress);
    float skin     = smoothstep(-0.28, 0.72, outer);
    float lift     = peel * skin;

    vec3 tangent = normalize(cross(vec3(0.0, 0.0, 1.0), ringDir));
    pos += normal  * lift * 0.56;
    pos += ringDir * lift * 0.14;
    pos += tangent * lift * 0.26;
    // a freed sheet is not rigid
    pos += normal * lift * noise(position * 3.1 + vec3(uTime * 1.25)) * 0.12;

    vPeel  = peel;
    vOuter = outer;

    vec4 world = modelMatrix * vec4(pos, 1.0);
    vec4 mv    = viewMatrix * world;
    vWorld  = world.xyz;
    vNormal = normalize(normalMatrix * normal);
    vView   = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  uniform float uScan;
  uniform float uScanPos;
  uniform float uSplit;
  uniform float uJolt;

  varying vec3  vNormal;
  varying vec3  vView;
  varying vec3  vWorld;
  varying float vPeel;
  varying float vOuter;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);

    // one key from the upper left as in the reference, plus a broad fill from
    // the lower right — that fill is what produces the second bright lobe on
    // the far side of the ring, the detail that proves this is real geometry
    vec3 key   = normalize(vec3(-0.55, 0.78, 0.42));
    vec3 fillD = normalize(vec3(0.72, -0.16, 0.38));

    /* Both lights are narrow lobes, not broad washes. A broad fill lifts every
       normal at once and the whole disc settles onto three or four mid ramp
       characters — which is exactly how the previous pass read. Concentrating
       them is what produces the reference's two separate bright masses with
       genuine black between them. */
    float diff = pow(max(dot(n, key),  0.0), 1.45);
    float fill = pow(max(dot(n, fillD), 0.0), 2.6) * 0.62;
    float rim  = pow(1.0 - max(dot(n, v), 0.0), 3.6) * 0.16;
    float spec = pow(max(dot(reflect(-key, n), v), 0.0), 26.0) * 0.42;

    /* A wrapped bounce term. Without it the whole shadow side of the object
       quantises to space and the silhouette collapses into two floating
       highlights — which is what the first pass of this fix did. The reference
       is solid across its entire silhouette: the dark side still lands on
       '.', ',' and '-', and that low end is most of what reads as mass. */
    float wrap = pow(max(dot(n, key) * 0.5 + 0.5, 0.0), 2.2) * 0.34;

    float l = 0.075 + diff * 0.78 + fill + wrap + rim + spec;

    /* --- inspect: a plane travelling through a solid ------------------------
       Measured against world Y on the interpolated world position, so it is a
       genuine plane cutting the tumbling object, continuous to the pixel. The
       old version quantised to the same seven bands as the split, which is why
       it read as chunky rather than as a cut. */
    float d = vWorld.y - uScanPos;

    /* Additive brightness alone was invisible: the lit side of the object is
       already near the top of a thirteen-character ramp, so adding to it
       clips, and it never reads as a plane at all. Instead the plane divides
       the object — everything it has not reached yet is held back, the cut
       itself blazes, and what it has passed through returns to full. That is
       a plane travelling through a solid, and it is legible on every frame. */
    float ahead = smoothstep(0.0, 0.42, d);        // not yet reached
    l *= mix(1.0, 0.55, uScan * ahead);
    l += uScan * exp(-(d * d) * 150.0) * 1.05;     // the cut locus
    l += uScan * smoothstep(0.75, 0.0, max(-d, 0.0)) * 0.07 * (1.0 - ahead);

    /* --- rewrite shading ----------------------------------------------------
       The moving front is the brightest thing on the object, and the interior
       exposed behind it goes dark, so you read depth under the lifted skin. */
    float front = vPeel * (1.0 - vPeel) * 4.0;
    l += uSplit * front * 0.38;
    l -= uSplit * vPeel * smoothstep(0.45, -0.35, vOuter) * 0.52;

    // a state change flares the silhouette for as long as the impulse rings
    l += uJolt * (rim * 0.55 + 0.04);

    /* --- tone curve -------------------------------------------------------
       The lighting was never the problem: measured over 12 idle frames the
       falloff was already ordered across 12 live ramp levels. The mapping was.
       A hard clamp let luminance saturate before the ramp top, so '@' alone
       took 17% of glyphs — more than '$' and '#' combined, a clipped plateau —
       while '.' took 1% and the object stepped from ',' straight into empty
       space with no deep shadow anywhere.

       An exponential shoulder approaches white asymptotically and never clips,
       so the top of the ramp is earned; the gamma under one lifts the shadow
       end so ',' and '.' carry real area and the silhouette reads solid. */
    // Shoulder, re-centre, then spread. Order matters: the gamma has to land
    // before the S-curve so it moves the median onto the curve's midpoint,
    // which is the only place the spread pushes symmetrically.
    float tone = 1.0 - exp(-max(l, 0.0) * 1.9);
    tone = pow(tone, 1.45);
    tone = tone * tone * (3.0 - 2.0 * tone);

    gl_FragColor = vec4(vec3(clamp(tone, 0.0, 1.0)), 1.0);
  }
`

const AX_Y = new THREE.Vector3(0, 1, 0)
const AX_X = new THREE.Vector3(1, 0, 0)
const AX_Z = new THREE.Vector3(0, 0, 1)

function Surface({
  state,
  pointer,
  reduce,
  out,
}: {
  state: SurfaceState
  pointer: React.MutableRefObject<{ x: number; y: number }>
  reduce: boolean
  out: React.MutableRefObject<HTMLPreElement | null>
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const { gl, scene, camera } = useThree()

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBreath: { value: reduce ? 0 : TARGETS.idle.breath },
      uSplit: { value: 0 },
      uScan: { value: 0 },
      uScanPos: { value: 0 },
      uJolt: { value: 0 },
      uMajorR: { value: MAJOR_R },
    }),
    [reduce],
  )

  /* Live values integrated toward the active state's targets. Held in refs so
     a state change costs one React render and the animation costs none.

     Each channel gets its own stiffness and damping, because they do not weigh
     the same: the spin rate is heavy and critically damped (a flywheel does
     not bounce), the delamination is light and overshoots, the breath is soft. */
  const springs = useRef<{ spin: Spring; breath: Spring; scan: Spring; split: Spring; jolt: Spring; bob: Spring }>({
    spin: spring(TARGETS.idle.spin, 9, 6.0),
    breath: spring(TARGETS.idle.breath, 26, 7.2),
    scan: spring(0, 40, 11),
    split: spring(0, 55, 8.2), // zeta ~0.55 — visibly overshoots, then settles
    jolt: spring(0, 120, 9),
    bob: spring(0, 46, 6.4),
  })
  const target = useRef({ ...TARGETS.idle })

  useEffect(() => {
    target.current = TARGETS[state]
    // the object is struck by the state change rather than cross-faded into it
    const s = springs.current
    impulse(s.jolt, state === 'success' ? 4.2 : 6.4)
    impulse(s.bob, state === 'rewriting' ? -2.6 : 1.9)
  }, [state])

  const rt = useMemo(
    () =>
      new THREE.WebGLRenderTarget(COLS, ROWS, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        /* Multisampling matters more here than anywhere else in the app: at
           96x54 a hard-edged silhouette quantises straight from '@' to space,
           which is the difference between a rendered solid and a stencil.
           Partial coverage lands on the low end of the ramp and the object
           gets the reference's soft ',.-' fringe. */
        samples: 4,
      }),
    [],
  )
  const buf = useMemo(() => new Uint8Array(COLS * ROWS * 4), [])
  useEffect(() => () => rt.dispose(), [rt])

  // the grid is the viewport, so compensate for the character cell's aspect —
  // otherwise a round object renders as an ellipse
  useEffect(() => {
    const probe = document.createElement('canvas').getContext('2d')
    let cell = 0.72
    if (probe) {
      probe.font = "32px 'Martian Mono', ui-monospace, monospace"
      cell = probe.measureText('M').width / 32
    }
    const cam = camera as THREE.PerspectiveCamera
    cam.aspect = (COLS * cell) / ROWS
    cam.updateProjectionMatrix()
  }, [camera])

  const last = useRef(0)
  const clock = useRef(0)

  /* One coherent cause for the tumble.
     Three independent sines on x/y/z sum to something that is technically
     rotating but has no single axis, so the eye never builds a model of the
     solid. This is instead a Euler top: the object spins about its own axis,
     that axis is tilted, and the tilt precesses. Three phases, one rigid body.
     Kept as quaternions so there is no gimbal artefact at the poles. */
  const phase = useRef({ spin: 0.6, prec: 0.9, nut: 0 })
  const q = useMemo(
    () => ({ prec: new THREE.Quaternion(), nut: new THREE.Quaternion(), spin: new THREE.Quaternion(), lag: new THREE.Quaternion() }),
    [],
  )
  const lag = useRef({ x: 0, y: 0, vx: 0, vy: 0 })

  useFrame((_, delta) => {
    const m = mesh.current
    if (!m) return

    const dt = Math.min(delta, 0.1)
    clock.current += dt
    const t = clock.current

    const s = springs.current
    const g = target.current
    stepSpring(s.spin, g.spin, dt)
    stepSpring(s.breath, g.breath, dt)
    stepSpring(s.scan, g.scan, dt)
    stepSpring(s.split, g.split, dt)
    stepSpring(s.jolt, 0, dt)
    stepSpring(s.bob, 0, dt)

    if (reduce) {
      // a complete, legible pose: tilted enough to show the hole and both lobes
      q.prec.setFromAxisAngle(AX_Y, 0.55)
      q.nut.setFromAxisAngle(AX_X, 0.78)
      q.spin.setFromAxisAngle(AX_Z, 0.35)
      m.quaternion.copy(q.prec).multiply(q.nut).multiply(q.spin)
      m.position.y = 0
      m.scale.setScalar(1)
      uniforms.uBreath.value = 0
      uniforms.uSplit.value = g.split
      uniforms.uScan.value = g.scan
      uniforms.uScanPos.value = 0.15
      uniforms.uJolt.value = 0
      uniforms.uTime.value = 0
    } else {
      const spin = s.spin.x

      // spin about the body axis, nutation tilting it away from the pole,
      // precession walking that tilt around the pole
      phase.current.spin += dt * (0.55 + spin * 0.62)
      phase.current.prec += dt * (0.10 + spin * 0.15)
      const nut = 0.70 + Math.sin(phase.current.prec * 0.83) * 0.40

      q.prec.setFromAxisAngle(AX_Y, phase.current.prec)
      q.nut.setFromAxisAngle(AX_X, nut)
      q.spin.setFromAxisAngle(AX_Z, phase.current.spin)
      m.quaternion.copy(q.prec).multiply(q.nut).multiply(q.spin)

      /* The object acknowledges the pointer; it does not follow it. Integrated
         through its own spring so the lean arrives late and settles — a solid
         with inertia rather than a cursor-parented div. */
      const L = lag.current
      L.vx += ((pointer.current.x - L.x) * 34 - L.vx * 9.5) * dt
      L.vy += ((pointer.current.y - L.y) * 34 - L.vy * 9.5) * dt
      L.x += L.vx * dt
      L.y += L.vy * dt
      q.lag.setFromAxisAngle(AX_X, L.y * 0.2)
      m.quaternion.premultiply(q.lag)
      q.lag.setFromAxisAngle(AX_Y, L.x * 0.26)
      m.quaternion.premultiply(q.lag)

      // mass: the state impulse makes it dip and recover, and the peeled form
      // pulls back a little so it stays inside the frame while it is open
      m.position.y = 0.13 + s.bob.x * 0.21
      m.scale.setScalar(1 - Math.max(s.split.x, 0) * 0.18)

      /* The scan plane accelerates in, sweeps, decelerates out, then holds
         before the next pass. A saw-tooth would snap back through the object. */
      const cyc = (t * 0.29) % 1
      const swept = cyc < 0.84 ? smootherstep(cyc / 0.84) : 1
      uniforms.uScanPos.value = -1.85 + swept * 3.7

      uniforms.uTime.value = t
      uniforms.uBreath.value = s.breath.x
      uniforms.uSplit.value = s.split.x
      uniforms.uScan.value = s.scan.x
      uniforms.uJolt.value = Math.max(0, s.jolt.x)
    }

    const now = performance.now()
    if (now - last.current < FRAME_MS) return
    last.current = now

    gl.setRenderTarget(rt)
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    gl.readRenderTargetPixels(rt, 0, 0, COLS, ROWS, buf)

    // straight to the DOM node — this must never pass through React state
    const el = out.current
    if (!el) return
    let str = ''
    for (let y = ROWS - 1; y >= 0; y--) {
      for (let x = 0; x < COLS; x++) {
        const i = (y * COLS + x) * 4
        const lum = (buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114) / 255
        str += RAMP[Math.min(RAMP.length - 1, Math.round(lum * (RAMP.length - 1)))]
      }
      if (y) str += '\n'
    }
    el.textContent = str
  }, 1)

  return (
    <mesh ref={mesh}>
      <torusGeometry args={[MAJOR_R, MINOR_R, 30, 96]} />
      <shaderMaterial vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
    </mesh>
  )
}

/**
 * SIGNATURE — the Surface.
 *
 * A real solid, lit and turning in perspective, rendered to a character grid.
 * Not a card, not a gradient, not a transform on a div: the depth is actual
 * depth, which is why the far side of the ring lights differently from the near
 * side as it comes round.
 */
export function AsciiSurface({
  state = 'idle',
  className = '',
  fontSize = 8,
}: {
  state?: SurfaceState
  className?: string
  fontSize?: number
}) {
  const out = useRef<HTMLPreElement | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const host = useRef<HTMLDivElement | null>(null)

  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduce) return
    const onMove = (e: PointerEvent) => {
      const el = host.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const clamp = (v: number) => Math.max(-1, Math.min(1, v))
      pointer.current.x = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * 1.3))
      pointer.current.y = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * 1.3))
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [reduce])

  return (
    <div ref={host} className={`mdb-surf ${className}`} data-state={state} aria-hidden="true">
      {/* the canvas only feeds the grid; it is never the thing you look at */}
      <div className="mdb-surf-gl">
        <Canvas
          frameloop={reduce ? 'demand' : 'always'}
          dpr={1}
          gl={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
          camera={{ position: [0, 0, 4.55], fov: 42 }}
        >
          <Surface state={state} pointer={pointer} reduce={reduce} out={out} />
        </Canvas>
      </div>
      <pre ref={out} className="mdb-surf-out" style={{ fontSize }} />
    </div>
  )
}
