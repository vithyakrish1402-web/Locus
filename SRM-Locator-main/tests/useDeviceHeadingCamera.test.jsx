// @vitest-environment jsdom
//
// AR Scan Stage 5c: useDeviceHeading's camera mode. The same listener reads the phone's
// full orientation (alpha, beta and gamma together) for a caller that looks through the
// camera; every other caller is untouched.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDeviceHeading } from '../src/hooks/useDeviceHeading.js';
import { deviceQuaternion, headingFromQuaternion, qAngleDeg } from '../src/utils/deviceOrientation.js';

const orient = (fields) => {
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, ...fields });
  window.dispatchEvent(event);
};
const granted = async (options) => {
  const hook = renderHook(() => useDeviceHeading(options));
  await act(async () => { await hook.result.current.requestHeadingPermission(); });
  return hook;
};
const headingGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('without camera mode (the map, App.jsx)', () => {
  it('reads 360 - alpha and reports no tilt, even with beta and gamma', async () => {
    const { result } = await granted();
    act(() => orient({ alpha: 330, beta: 88, gamma: 12 }));
    expect(result.current.headingRef.current).toBe(30);
    expect(result.current.tilt).toBeNull();
  });
});

describe('camera mode', () => {
  it('reads the heading from the whole orientation, where 360 - alpha would be far off', async () => {
    const { result } = await granted({ camera: true });
    // Upright, facing 30 deg, pitched 5 deg down and rolled 1 deg: a browser reports
    // alpha 318.7, and 360 - alpha is 41.3.
    const e = { alpha: 318.7, beta: 84.9, gamma: 11.3 };
    act(() => orient(e));
    const want = headingFromQuaternion(deviceQuaternion(e.alpha, e.beta, e.gamma));
    expect(result.current.headingRef.current).toBeCloseTo(want, 6);
    expect(headingGap(want, 30)).toBeLessThan(0.5);
    expect(headingGap(360 - e.alpha, 30)).toBeGreaterThan(10);
  });

  it('falls back to 360 - alpha when an event has no beta and gamma', async () => {
    const { result } = await granted({ camera: true, tilt: true });
    act(() => orient({ alpha: 90 }));
    expect(result.current.headingRef.current).toBe(270);
    act(() => orient({ alpha: 90, beta: null, gamma: null }));
    expect(result.current.tilt).toBeNull(); // no live tilt: the camera's fallback applies
  });

  it('reports no tilt unless asked for it', async () => {
    const { result } = await granted({ camera: true });
    act(() => orient({ alpha: 0, beta: 70, gamma: 0 }));
    expect(result.current.tilt).toBeNull();
  });

  it('reports the live tilt: the orientation and the heading it has by itself', async () => {
    const { result } = await granted({ camera: true, tilt: true });
    act(() => orient({ alpha: 20, beta: 70, gamma: -5 }));
    const q = deviceQuaternion(20, 70, -5);
    expect(qAngleDeg(result.current.tilt.q, q)).toBeLessThan(1e-4);
    expect(result.current.tilt.heading).toBeCloseTo(headingFromQuaternion(q), 6);
  });

  it('smooths the tilt, and updates it at most every 100 ms, on its own gate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { result } = await granted({ camera: true, tilt: true });
    act(() => orient({ alpha: 0, beta: 70, gamma: 0 }));
    const first = result.current.tilt;
    // A pure tilt (heading unchanged) within 100 ms: not yet.
    act(() => orient({ alpha: 0, beta: 60, gamma: 0 }));
    expect(result.current.tilt).toBe(first);
    vi.setSystemTime(1_000_200);
    act(() => orient({ alpha: 0, beta: 60, gamma: 0 }));
    const moved = qAngleDeg(first.q, result.current.tilt.q);
    // Two smoothed steps (HEADING_SMOOTHING_ALPHA 0.2) toward a 10 deg change close
    // 1 - 0.8^2 = 36% of it: about 3.6 deg, not all 10.
    expect(moved).toBeGreaterThan(3);
    expect(moved).toBeLessThan(4.5);
  });

  it('corrects for a landscape screen', async () => {
    // jsdom has no screen.orientation; a phone turned to landscape reports angle 90.
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { angle: 90 } });
    try {
      const { result } = await granted({ camera: true, tilt: true });
      act(() => orient({ alpha: 10, beta: 5, gamma: -80 }));
      expect(qAngleDeg(result.current.tilt.q, deviceQuaternion(10, 5, -80, 90))).toBeLessThan(1e-4);
      expect(qAngleDeg(result.current.tilt.q, deviceQuaternion(10, 5, -80, 0))).toBeGreaterThan(80);
    } finally {
      delete window.screen.orientation;
    }
  });
});
