// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDeviceHeading, smoothHeading } from '../src/hooks/useDeviceHeading.js';

// A deviceorientation event as Android fires it: absolute when it comes from the compass.
const orient = (type, { absolute, alpha }) => {
  const event = new Event(type);
  Object.assign(event, { absolute, alpha });
  window.dispatchEvent(event);
};

afterEach(cleanup);

describe('useDeviceHeading().hasReading', () => {
  // The squad roster only speaks in "3 O'CLOCK" terms once this is true. Before it existed,
  // a phone without a compass (or a desktop browser) sat at heading 0 forever, which would
  // have passed for "facing north".
  it('stays false while nothing has been heard, even with the listener attached', async () => {
    const { result } = renderHook(() => useDeviceHeading());
    await act(async () => { await result.current.requestHeadingPermission(); });
    expect(result.current.permissionsGranted).toBe(true);
    expect(result.current.hasReading).toBe(false);
  });

  it('ignores relative (non-compass) readings', async () => {
    const { result } = renderHook(() => useDeviceHeading());
    await act(async () => { await result.current.requestHeadingPermission(); });
    act(() => orient('deviceorientation', { absolute: false, alpha: 120 }));
    expect(result.current.hasReading).toBe(false);
  });

  it('turns true on the first absolute reading', async () => {
    const { result } = renderHook(() => useDeviceHeading());
    await act(async () => { await result.current.requestHeadingPermission(); });
    act(() => orient('deviceorientationabsolute', { absolute: true, alpha: 90 }));
    expect(result.current.hasReading).toBe(true);
    expect(result.current.headingRef.current).toBe(270); // 360 - alpha
  });
});

describe('smoothHeading', () => {
  it('takes the first reading as-is', () => {
    expect(smoothHeading(null, 123).heading).toBeCloseTo(123, 6);
  });

  it('averages across north instead of swinging through south', () => {
    let s = smoothHeading(null, 350);
    s = smoothHeading(s.vec, 10, 0.5);
    const h = s.heading;
    expect(Math.min(h, 360 - h)).toBeLessThan(0.001); // due north, not 180
  });

  it('closes the given fraction of a small gap per step', () => {
    const s = smoothHeading(smoothHeading(null, 90).vec, 100, 0.2);
    expect(s.heading).toBeGreaterThan(91.5);
    expect(s.heading).toBeLessThan(92.5);
  });
});

describe('useDeviceHeading() smoothing', () => {
  it('damps a one-event spike instead of passing it straight through', async () => {
    const { result } = renderHook(() => useDeviceHeading());
    await act(async () => { await result.current.requestHeadingPermission(); });
    act(() => orient('deviceorientationabsolute', { absolute: true, alpha: 90 })); // 270
    act(() => orient('deviceorientationabsolute', { absolute: true, alpha: 60 })); // raw 300
    const h = result.current.headingRef.current;
    expect(h).toBeGreaterThan(272);
    expect(h).toBeLessThan(290);
  });

  it('still follows a real turn, across north', async () => {
    const { result } = renderHook(() => useDeviceHeading());
    await act(async () => { await result.current.requestHeadingPermission(); });
    act(() => orient('deviceorientationabsolute', { absolute: true, alpha: 10 })); // 350
    for (let i = 0; i < 40; i++) {
      act(() => orient('deviceorientationabsolute', { absolute: true, alpha: 340 })); // 20
    }
    expect(result.current.headingRef.current).toBeCloseTo(20, 1);
  });
});
