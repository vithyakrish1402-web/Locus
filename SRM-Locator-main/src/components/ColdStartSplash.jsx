import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import '@fontsource/dm-sans/latin-700.css'
import { auth } from '../firebase.js'
import { LAYER } from '../utils/layers.js'

// Colours live here so the app's new theme can swap them in one place.
const SPLASH_VARS = {
  '--splash-bg': '#14284d',
  '--splash-gold': '#d9952b',
}

// The animation is authored on an 8 s timeline (docs/reference/locus-cold-start.html) and
// played 1.5x. END_T is where a one-shot run stops: the reference fades the whole scene out
// at 7.6-8 so its loop can restart, but here the overlay's own fade is the exit, so the
// last frame (ring, pin, wordmark) is held instead.
const TIMELINE = 8
const SPEED = 1.5
const END_T = 7.6
const FADE_MS = 250
const HARD_CAP_MS = 8000
const REDUCED_MOTION_MS = 600

// Once per JS context: a resume from the background never reloads the page, so it never
// reaches this again. Set when the splash finishes, not when it mounts, so StrictMode's
// mount-unmount-mount in dev still plays it.
let played = false

// ---- Copied as-is from the reference ------------------------------------------------
const cl = (x) => Math.min(1, Math.max(0, x))
const pr = (t, a, b) => cl((t - a) / (b - a))
const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
const bounce = (x) => {
  const n = 7.5625, d = 2.75
  if (x < 1 / d) return n * x * x
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375
  return n * (x -= 2.625 / d) * x + 0.984375
}
const back = (x) => {
  const c = 1.70158 + 1
  return 1 + (c + 0) * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2)
}
// pin -> stem control points: tip,c1,c2,left,tc1,tc2,right,c3,c4
const P = [[0, 340], [-40, 280], [-200, 120], [-200, -20], [-200, -287], [200, -287], [200, -20], [200, 120], [40, 280]]
const path = (q) => `M${q[0]}C${q[1]} ${q[2]} ${q[3]}C${q[4]} ${q[5]} ${q[6]}C${q[7]} ${q[8]} ${q[0]}Z`
const PIN_D = path(P)
const SPIN_D = 'M0 130C-18 105-80 50-80-10C-80-117 80-117 80-10C80 50 18 105 0 130Z'
const vis = (el, v) => { el.style.display = v ? '' : 'none' }
const pt = (l) => (l <= 240 ? [-70, -120 + l] : [-70 + (l - 240), 120])
const sm = (x) => x * x * x * (x * (x * 6 - 15) + 10)
const bez = (p0, c, p2, q) => {
  const u = 1 - q
  return [u * u * p0[0] + 2 * u * q * c[0] + q * q * p2[0], u * u * p0[1] + 2 * u * q * c[1] + q * q * p2[1]]
}
function dotAt(t) {
  if (t < 1.8) { const dy = -800 * (1 - bounce(pr(t, 0, 0.9))), pl = 1 + 0.4 * Math.sin(Math.PI * pr(t, 0.9, 1.2)); return [0, -20 + dy, 42 * pl] }
  if (t < 2.4) { const q = sm(pr(t, 1.8, 2.4)), [x, y] = bez([0, -20], [0, -120], [-70, -120], q); return [x, y, 42 - 12 * q] }
  if (t < 3.6) { const [x, y] = pt(400 * sm(pr(t, 2.4, 3.6))); return [x, y, 30] }
  if (t < 4.5) return [90, 120, 30]
  const q = sm(pr(t, 4.5, 5.3)), [x, y] = bez([90, 120], [120, 20], [0, -10], q)
  return [x, y, 30 - 13 * q]
}

// `e` is the element map from collect(); `fadeScene` is the reference's end-of-loop fade.
function render(e, t, fadeScene) {
  const dy = -800 * (1 - bounce(pr(t, 0, 0.9))), ps = 1 - eio(pr(t, 1.2, 2))
  vis(e.pin, t < 2); vis(e.hole, t < 2)
  e.pin.setAttribute('d', PIN_D)
  e.pin.setAttribute('transform', `translate(0 ${dy}) translate(0 -20) scale(${ps}) translate(0 20)`)
  const h = e.hole; h.setAttribute('cx', 0); h.setAttribute('cy', -20 + dy); h.setAttribute('r', 84 * ps)
  vis(e.lF, t >= 2.4 && t < 4); vis(e.lR, t >= 4 && t < 4.9)
  e.lF.setAttribute('stroke-dashoffset', 400 - 400 * sm(pr(t, 2.4, 3.6)))
  e.lR.setAttribute('stroke-dashoffset', 400 * sm(pr(t, 4, 4.9)))
  const [x, y, r] = dotAt(t), a = dotAt(t - 0.03), b = dotAt(t + 0.03)
  const vx = b[0] - a[0], vy = b[1] - a[1], sp = Math.hypot(vx, vy), st = 1 + Math.min(0.3, sp / 70)
  const d = e.dot, R = Math.max(0, r)
  d.setAttribute('r', R)
  d.setAttribute('transform', `translate(${x} ${y}) rotate(${Math.atan2(vy, vx) * 180 / Math.PI}) scale(${st} ${1 / Math.sqrt(st)})`);
  [1, 2, 3].forEach((k) => {
    const [gx, gy, gr] = dotAt(t - k * 0.07), g = e['g' + k]
    g.setAttribute('cx', gx); g.setAttribute('cy', gy); g.setAttribute('r', Math.max(0, gr * (1 - k * 0.18)))
    g.style.opacity = Math.min(1, sp / 12) * (0.32 - k * 0.09)
  })
  e.ring.setAttribute('stroke-dashoffset', 1445 * (1 - sm(pr(t, 5, 6.1))))
  e.ring.setAttribute('transform', `rotate(-90) scale(${1 + 0.1 * sm(pr(t, 6.1, 7.2))})`)
  const s = t >= 5.4 ? back(pr(t, 5.4, 6.1)) : 0
  vis(e.spin, s > 0); vis(e.shole, s > 0)
  e.spin.setAttribute('transform', `translate(0 -10) scale(${s}) translate(0 10)`)
  e.shole.setAttribute('r', 34 * s)
  const wd = e.word, n = 5, k = Math.min(n, Math.max(0, Math.floor((t - 6.1) / 0.14) + 1));
  [...wd.children].forEach((c, i) => c.setAttribute('fill-opacity', i < k ? 1 : 0))
  const cu = e.cur
  if (t >= 6) {
    // jsdom has no SVG text metrics; the cursor just sits at the left edge there.
    let cx = 540
    if (typeof wd.getEndPositionOfChar === 'function') {
      cx = k > 0 ? wd.getEndPositionOfChar(k - 1).x : wd.getStartPositionOfChar(0).x
    }
    cu.setAttribute('x', cx + 4)
    cu.setAttribute('opacity', (k < n || Math.floor(t * 5) % 2 === 0) ? 1 : 0)
  } else cu.setAttribute('opacity', 0)
  if (fadeScene) e.scene.style.opacity = 1 - pr(t, 7.6, 8)
}
// -------------------------------------------------------------------------------------

const IDS = ['scene', 'pin', 'hole', 'lF', 'lR', 'ring', 'spin', 'shole', 'g3', 'g2', 'g1', 'dot', 'word', 'cur']
const collect = (svg) => Object.fromEntries(IDS.map((id) => [id, svg.querySelector(`[data-id="${id}"]`)]))

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
  Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches)

// Native bars: navy behind the splash (light icons), back to the system default after.
// The overlay already draws under the bars (edge-to-edge), so only the icons need setting.
// A shell that predates the plugin rejects the call; nothing depends on it.
function setBars(onSplash) {
  if (!Capacitor.isNativePlatform()) return
  StatusBar.setStyle({ style: onSplash ? Style.Dark : Style.Default }).catch(() => {})
}

const defaultBootReady = () => auth.authStateReady()

export default function ColdStartSplash({ loop = false, bootReady = defaultBootReady }) {
  const svgRef = useRef(null)
  const [active] = useState(() => loop || !played)
  const [animDone, setAnimDone] = useState(false)
  const [authDone, setAuthDone] = useState(false)
  const [capped, setCapped] = useState(false)
  const [gone, setGone] = useState(!active)
  const reduced = active && reducedMotion()

  // Frame 0 is on screen before the first paint, so no half-drawn pin flashes.
  useLayoutEffect(() => {
    // The static navy cover from index.html; this overlay (same commit, same paint) replaces it.
    document.getElementById('splash-backdrop')?.remove()
    if (!active) return
    render(collect(svgRef.current), reduced ? END_T : 0, loop)
  }, [active, reduced, loop])

  useEffect(() => {
    if (!active) return undefined
    setBars(true)
    return undefined
  }, [active])

  useEffect(() => {
    if (!active) return undefined
    let live = true
    Promise.resolve().then(bootReady).catch(() => {}).then(() => { if (live) setAuthDone(true) })
    const cap = setTimeout(() => setCapped(true), HARD_CAP_MS)
    return () => { live = false; clearTimeout(cap) }
  }, [active, bootReady])

  useEffect(() => {
    if (!active) return undefined
    if (reduced) {
      const id = setTimeout(() => setAnimDone(true), REDUCED_MOTION_MS)
      return () => clearTimeout(id)
    }
    const els = collect(svgRef.current)
    let raf = 0
    let t0 = null
    const frame = (now) => {
      if (t0 === null) t0 = now
      const elapsed = Math.max(0, (now - t0) / 1000) * SPEED
      if (loop) {
        render(els, elapsed % TIMELINE, true)
      } else if (elapsed >= END_T) {
        render(els, END_T, false)
        setAnimDone(true)
        return
      } else {
        render(els, elapsed, false)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [active, reduced, loop])

  const fading = active && !loop && ((animDone && authDone) || capped)

  useEffect(() => {
    if (!fading) return undefined
    played = true
    setBars(false)
    const id = setTimeout(() => setGone(true), FADE_MS)
    return () => clearTimeout(id)
  }, [fading])

  if (gone) return null

  return (
    <div
      data-testid="cold-start-splash"
      data-fading={fading ? 'true' : 'false'}
      style={{
        ...SPLASH_VARS,
        position: 'fixed',
        inset: 0,
        zIndex: LAYER.coldStart,
        background: 'var(--splash-bg)',
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      <svg
        ref={svgRef}
        viewBox="0 0 1080 1920"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Locus"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <rect width="1080" height="1920" style={{ fill: 'var(--splash-bg)' }} />
        <g data-id="scene">
          <g transform="translate(540 880)">
            <path data-id="pin" fill="#fff" />
            <circle data-id="hole" style={{ fill: 'var(--splash-bg)' }} />
            <path data-id="lF" d="M-70 -120V120H90" fill="none" stroke="#fff" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="400 400" />
            <path data-id="lR" d="M90 120H-70V-120" fill="none" stroke="#fff" strokeWidth="36" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="400 400" />
            <circle data-id="ring" r="230" fill="none" stroke="#fff" strokeWidth="22" transform="rotate(-90)" strokeDasharray="1445 1445" />
            <path data-id="spin" d={SPIN_D} fill="#fff" />
            <circle data-id="shole" style={{ fill: 'var(--splash-bg)' }} cx="0" cy="-10" />
            <circle data-id="g3" style={{ fill: 'var(--splash-gold)' }} />
            <circle data-id="g2" style={{ fill: 'var(--splash-gold)' }} />
            <circle data-id="g1" style={{ fill: 'var(--splash-gold)' }} />
            <circle data-id="dot" style={{ fill: 'var(--splash-gold)' }} />
          </g>
          <text
            data-id="word"
            x="540" y="1330" textAnchor="middle" fill="#fff"
            fontFamily="'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
            fontSize="120" fontWeight="700" letterSpacing="3"
          >
            <tspan>L</tspan><tspan>o</tspan><tspan>c</tspan><tspan>u</tspan><tspan>s</tspan>
          </text>
          <rect data-id="cur" y="1244" width="8" height="104" style={{ fill: 'var(--splash-gold)' }} opacity="0" />
        </g>
      </svg>
    </div>
  )
}
