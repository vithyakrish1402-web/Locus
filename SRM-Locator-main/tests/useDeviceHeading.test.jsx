// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useDeviceHeading } from '../src/hooks/useDeviceHeading.js';

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
