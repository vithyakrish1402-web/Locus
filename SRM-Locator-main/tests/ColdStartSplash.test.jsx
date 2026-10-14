// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

vi.mock('../src/firebase.js', () => ({ auth: { authStateReady: () => Promise.resolve() } }))

// The module remembers that it has played, so every test gets a fresh copy.
async function load() {
  vi.resetModules()
  return (await import('../src/components/ColdStartSplash.jsx')).default
}

const ready = () => Promise.resolve()
const never = () => new Promise(() => {})
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const splash = (c) => c.querySelector('[data-testid="cold-start-splash"]')

function setReducedMotion(on) {
  window.matchMedia = (q) => ({ matches: on && q.includes('reduced-motion'), addEventListener() {}, removeEventListener() {} })
}

beforeEach(() => {
  vi.useFakeTimers()
  setReducedMotion(false)
  document.body.insertAdjacentHTML('afterbegin', '<div id="splash-backdrop"></div>')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.getElementById('splash-backdrop')?.remove()
})

describe('ColdStartSplash', () => {
  it('paints frame 0 on mount and takes down the static backdrop from index.html', async () => {
    const Splash = await load()
    const { container } = render(<Splash bootReady={never} />)
    expect(splash(container)).not.toBeNull()
    expect(container.querySelector('[data-id="pin"]').getAttribute('d')).toMatch(/^M0,?340C/)
    expect(document.getElementById('splash-backdrop')).toBeNull()
  })

  it('plays the whole timeline (1.5x), then fades for 250 ms and unmounts', async () => {
    const Splash = await load()
    const { container } = render(<Splash bootReady={ready} />)
    await advance(4900) // 7.35 timeline seconds: wordmark still typing out the cursor, not done
    expect(splash(container).dataset.fading).toBe('false')
    await advance(400) // past 7.6 timeline seconds (~5.07 s)
    expect(splash(container).dataset.fading).toBe('true')
    const word = [...container.querySelectorAll('[data-id="word"] tspan')]
    expect(word.map((t) => t.getAttribute('fill-opacity'))).toEqual(['1', '1', '1', '1', '1'])
    await advance(100)
    expect(splash(container)).not.toBeNull() // still mid-fade
    await advance(160)
    expect(splash(container)).toBeNull()
  })

  it('holds the last frame, not the reference\'s end-of-loop fade, while waiting on boot', async () => {
    const Splash = await load()
    const { container } = render(<Splash bootReady={never} />)
    await advance(6000)
    expect(splash(container).dataset.fading).toBe('false')
    expect(container.querySelector('[data-id="scene"]').style.opacity).toBe('')
  })

  it('waits for the boot check, but never past the 8 s hard cap', async () => {
    const Splash = await load()
    const { container } = render(<Splash bootReady={never} />)
    await advance(7900)
    expect(splash(container).dataset.fading).toBe('false')
    await advance(200)
    expect(splash(container).dataset.fading).toBe('true')
  })

  it('does not hang on a boot check that fails', async () => {
    const Splash = await load()
    const { container } = render(<Splash bootReady={() => Promise.reject(new Error('x'))} />)
    await advance(5400)
    expect(splash(container).dataset.fading).toBe('true')
  })

  it('plays once per launch: a later mount shows nothing', async () => {
    const Splash = await load()
    const first = render(<Splash bootReady={ready} />)
    await advance(5400)
    await advance(400)
    expect(splash(first.container)).toBeNull()
    first.unmount()
    const again = render(<Splash bootReady={ready} />)
    expect(splash(again.container)).toBeNull()
  })

  it('a StrictMode double mount still plays it', async () => {
    const { StrictMode } = await import('react')
    const Splash = await load()
    const { container } = render(<StrictMode><Splash bootReady={ready} /></StrictMode>)
    await advance(1000)
    expect(splash(container)).not.toBeNull()
    expect(splash(container).dataset.fading).toBe('false')
  })

  it('reduced motion: final frame straight away, fade out after about 600 ms', async () => {
    setReducedMotion(true)
    const Splash = await load()
    const { container } = render(<Splash bootReady={ready} />)
    const word = [...container.querySelectorAll('[data-id="word"] tspan')]
    expect(word.map((t) => t.getAttribute('fill-opacity'))).toEqual(['1', '1', '1', '1', '1'])
    expect(container.querySelector('[data-id="ring"]').getAttribute('stroke-dashoffset')).toBe('0')
    await advance(500)
    expect(splash(container).dataset.fading).toBe('false')
    await advance(200)
    expect(splash(container).dataset.fading).toBe('true')
  })

  it('loop prop keeps playing and never fades', async () => {
    const Splash = await load()
    const { container } = render(<Splash loop bootReady={ready} />)
    await advance(20000)
    expect(splash(container).dataset.fading).toBe('false')
  })
})
