// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// Each WiFi module counts its own loading. With the flag off, none may load at all: the
// point is that no WiFi code runs, not merely that the answer comes back as GPS.
const loads = vi.hoisted(() => ({ wifiFusion: 0, wifiScan: 0, wifiPositioning: 0 }));
const fusion = vi.hoisted(() => ({ start: null, resolve: null, stop: null, indoor: null, listeners: null }));

const GPS = { lat: 12.8231, lng: 80.0442 };

async function loadHook({ enabled }) {
  vi.resetModules();
  vi.doMock('../src/utils/positionSource.js', async (importOriginal) => ({
    ...(await importOriginal()),
    WIFI_POSITIONING_ENABLED: enabled,
  }));
  vi.doMock('../src/utils/wifiFusion.js', () => {
    loads.wifiFusion++;
    return { startWifiFusion: fusion.start };
  });
  vi.doMock('../src/utils/wifiScan.js', () => {
    loads.wifiScan++;
    return {};
  });
  vi.doMock('../src/utils/wifiPositioning.js', () => {
    loads.wifiPositioning++;
    return {};
  });
  return (await import('../src/hooks/useWifiFusion.js')).useWifiFusion;
}

// Let the hook's dynamic import() and its .then() run.
const settle = () => act(async () => {});

beforeEach(() => {
  loads.wifiFusion = loads.wifiScan = loads.wifiPositioning = 0;
  fusion.resolve = vi.fn(() => ({ lat: 1, lng: 2, positionSource: 'wifi' }));
  fusion.stop = vi.fn();
  fusion.indoor = null;
  fusion.listeners = new Set();
  fusion.start = vi.fn(() => ({
    resolve: fusion.resolve,
    stop: fusion.stop,
    indoor: () => fusion.indoor,
    subscribe: (listener) => {
      fusion.listeners.add(listener);
      return () => fusion.listeners.delete(listener);
    },
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('flag off (the shipped default)', () => {
  it('is off in the source', async () => {
    vi.resetModules();
    vi.doUnmock('../src/utils/positionSource.js');
    const { WIFI_POSITIONING_ENABLED } = await import('../src/utils/positionSource.js');
    expect(WIFI_POSITIONING_ENABLED).toBe(false);
  });

  it('loads no WiFi module, starts no timer, and answers GPS - even while active', async () => {
    const useWifiFusion = await loadHook({ enabled: false });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const { result, rerender, unmount } = renderHook(({ active }) => useWifiFusion(active), {
      initialProps: { active: true },
    });
    await settle();
    rerender({ active: false });
    rerender({ active: true });
    await settle();

    expect(result.current.positionFor(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    expect(result.current.indoor).toBeNull();
    unmount();
    expect(loads).toEqual({ wifiFusion: 0, wifiScan: 0, wifiPositioning: 0 });
    expect(fusion.start).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('keeps the telemetry payload shape, plus positionSource', async () => {
    const useWifiFusion = await loadHook({ enabled: false });
    const { result } = renderHook(() => useWifiFusion(true));
    // Exactly lat/lng as before, so spreading it into update-location changes nothing else.
    expect(Object.keys(result.current.positionFor({ ...GPS, extra: 1 }))).toEqual(['lat', 'lng', 'positionSource']);
  });
});

describe('flag on', () => {
  it('starts fusion while active and routes positions through it', async () => {
    const useWifiFusion = await loadHook({ enabled: true });
    const { result } = renderHook(() => useWifiFusion(true));
    expect(result.current.positionFor(GPS).positionSource).toBe('gps'); // before the chunk has loaded
    await settle();

    expect(fusion.start).toHaveBeenCalledTimes(1);
    expect(result.current.positionFor(GPS)).toEqual({ lat: 1, lng: 2, positionSource: 'wifi' });
    expect(fusion.resolve).toHaveBeenCalledWith(GPS);
  });

  it('does nothing while inactive (not in a squad, or not yet approved)', async () => {
    const useWifiFusion = await loadHook({ enabled: true });
    const { result } = renderHook(() => useWifiFusion(false));
    await settle();
    expect(loads.wifiFusion).toBe(0);
    expect(result.current.positionFor(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
  });

  it('stops fusion and returns to GPS when it goes inactive or unmounts', async () => {
    const useWifiFusion = await loadHook({ enabled: true });
    const { result, rerender, unmount } = renderHook(({ active }) => useWifiFusion(active), {
      initialProps: { active: true },
    });
    await settle();
    rerender({ active: false });
    expect(fusion.stop).toHaveBeenCalledTimes(1);
    expect(result.current.positionFor(GPS).positionSource).toBe('gps');

    rerender({ active: true });
    await settle();
    unmount();
    expect(fusion.stop).toHaveBeenCalledTimes(2);
  });

  it('never starts fusion if it went inactive before the chunk loaded', async () => {
    const useWifiFusion = await loadHook({ enabled: true });
    const { rerender } = renderHook(({ active }) => useWifiFusion(active), { initialProps: { active: true } });
    rerender({ active: false }); // before settle
    await settle();
    expect(fusion.start).not.toHaveBeenCalled();
  });

  it('keeps a stable positionFor, so the telemetry effect is never re-run by it', async () => {
    const useWifiFusion = await loadHook({ enabled: true });
    const { result, rerender } = renderHook(({ active }) => useWifiFusion(active), { initialProps: { active: true } });
    const first = result.current.positionFor;
    await settle();
    rerender({ active: false });
    expect(result.current.positionFor).toBe(first);
  });
});

describe('flag on: the indoor reading (Stage 7)', () => {
  const INDOOR = { lat: 1, lng: 2, building: 'TECH PARK', floor: 2, confidence: 0.8, floors: [0, 1, 2] };
  const notify = (value) => act(() => {
    fusion.indoor = value;
    fusion.listeners.forEach((listener) => listener());
  });

  it('follows the controller: shown after a cycle, gone when a cycle loses it', async () => {
    const useWifiFusion = await loadHook({ enabled: true });
    const { result } = renderHook(() => useWifiFusion(true));
    await settle();
    expect(result.current.indoor).toBeNull();

    notify({ ...INDOOR, expiresAt: Date.now() + 60_000 });
    expect(result.current.indoor).toMatchObject(INDOOR);
    notify(null);
    expect(result.current.indoor).toBeNull();
  });

  it('drops a reading the moment it expires, even with no cycle due', async () => {
    vi.useFakeTimers();
    try {
      const useWifiFusion = await loadHook({ enabled: true });
      const { result } = renderHook(() => useWifiFusion(true));
      await settle();
      notify({ ...INDOOR, expiresAt: Date.now() + 5_000 });
      fusion.indoor = null; // what the controller answers once stale; no listener call
      act(() => vi.advanceTimersByTime(4_000));
      expect(result.current.indoor).not.toBeNull();
      act(() => vi.advanceTimersByTime(1_500));
      expect(result.current.indoor).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears it when going inactive', async () => {
    const useWifiFusion = await loadHook({ enabled: true });
    const { result, rerender } = renderHook(({ active }) => useWifiFusion(active), { initialProps: { active: true } });
    await settle();
    notify({ ...INDOOR, expiresAt: Date.now() + 60_000 });
    rerender({ active: false });
    expect(result.current.indoor).toBeNull();
    expect(fusion.listeners.size).toBe(0);
  });
});
