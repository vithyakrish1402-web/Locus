// @vitest-environment jsdom
//
// AR Scan Stage 5a: 'realistic' mode draws the arrow with three.js. The three.js module
// (arArrowScene.js) is stood in for, so these run without WebGL; its maths is tested in
// arArrowScene.test.js.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';

// The stand-in records whether it was ever loaded, and every view it made.
const gl = vi.hoisted(() => ({ loaded: false, views: [], fail: false }));
vi.mock('../src/utils/arArrowScene.js', () => {
  gl.loaded = true;
  return {
    createArrowView: vi.fn(() => {
      if (gl.fail) throw new Error('WebGL unavailable');
      const view = { setRotation: vi.fn(), setView: vi.fn(), render: vi.fn(), dispose: vi.fn() };
      gl.views.push(view);
      return view;
    }),
  };
});
// The real useSpring, watched to check it gets the CSS arrow's spring.
const springs = vi.hoisted(() => []);
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useSpring: (v, config) => { springs.push(config); return actual.useSpring(v, config); } };
});

const { default: ARCompass } = await import('../src/ARCompass.jsx');

beforeEach(() => {
  gl.views.length = 0;
  gl.fail = false;
  springs.length = 0;
});
afterEach(cleanup);

const HERE = { lat: 12.8230, lng: 80.0440 };
const TARGET = { name: 'X', lat: 12.8240, lng: 80.0440 };
const compass = (fidelity) => <ARCompass target={TARGET} liveLocation={HERE} fidelity={fidelity} onClose={() => {}} />;
const open = async (fidelity) => {
  const view = render(compass(fidelity));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  await act(async () => {}); // the dynamic import settles
  return view;
};
const cssArrow = () => screen.queryByTestId('ar-arrow-3d');
const canvas = () => screen.queryByTestId('ar-arrow-gl');

// Runs first: nothing has loaded the three.js module yet in this file.
describe('loading three.js', () => {
  it('never loads it outside realistic mode', async () => {
    await open('efficient');
    cleanup();
    await open('standard');
    expect(gl.loaded).toBe(false);
    expect(canvas()).toBeNull();
    expect(cssArrow()).toBeTruthy();
  });

  it('loads it in realistic mode', async () => {
    await open('realistic');
    expect(gl.loaded).toBe(true);
    expect(gl.views).toHaveLength(1);
  });
});

describe('realistic mode', () => {
  it('draws the three.js arrow over the camera view instead of the CSS one', async () => {
    await open('realistic');
    expect(canvas()).toBeTruthy();
    expect(cssArrow()).toBeNull();
    // Over the whole AR screen, not inside the ring.
    expect(canvas().parentElement.className).toContain('fixed inset-0');
    expect(screen.getByTestId('ar-arrow-ring').contains(canvas())).toBe(false);
    const [view] = gl.views;
    expect(view.setView).toHaveBeenCalled();
    expect(view.render).toHaveBeenCalled();
    // AR Scan's angle (target due north, no compass reading yet: 0).
    expect(view.setRotation).toHaveBeenCalledWith(0);
  });

  it('turns to AR Scan’s angle', async () => {
    const { MotionGlobalConfig } = await import('framer-motion');
    MotionGlobalConfig.skipAnimations = true; // settle the spring at once
    try {
      // Target due east, phone facing north (no compass reading yet): 90 degrees.
      render(<ARCompass target={{ name: 'E', lat: HERE.lat, lng: 80.0460 }} liveLocation={HERE} fidelity="realistic" onClose={() => {}} />);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
      await act(async () => {});
      const calls = gl.views.at(-1).setRotation.mock.calls;
      expect(calls.at(-1)[0]).toBeCloseTo(90, 0);
    } finally {
      MotionGlobalConfig.skipAnimations = false;
    }
  });

  it('eases the angle on the same spring as the CSS arrow', async () => {
    await open('realistic');
    expect(springs.at(-1)).toEqual({ stiffness: 100, damping: 15 });
  });

  it('keeps the CSS arrow when WebGL is unavailable', async () => {
    gl.fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open('realistic');
    expect(cssArrow()).toBeTruthy();
    expect(canvas()).toBeNull();
    warn.mockRestore();
  });

  it('releases WebGL when AR Scan closes', async () => {
    const { unmount } = await open('realistic');
    const [view] = gl.views;
    expect(view.dispose).not.toHaveBeenCalled();
    unmount();
    expect(view.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases WebGL when the mode changes, and starts afresh when it comes back', async () => {
    const { rerender } = await open('realistic');
    const [first] = gl.views;
    rerender(compass('standard'));
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(canvas()).toBeNull();
    expect(cssArrow()).toBeTruthy();

    rerender(compass('realistic'));
    await act(async () => {});
    expect(gl.views).toHaveLength(2);
    expect(canvas()).toBeTruthy();
    expect(cssArrow()).toBeNull();
    for (let i = 0; i < 3; i++) {
      rerender(compass('efficient'));
      rerender(compass('realistic'));
      await act(async () => {});
    }
    // Every view made has been released, except the one on screen now.
    expect(gl.views.slice(0, -1).every((v) => v.dispose.mock.calls.length === 1)).toBe(true);
    expect(gl.views.at(-1).dispose).not.toHaveBeenCalled();
  });
});
