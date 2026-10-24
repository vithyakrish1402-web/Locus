// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useNavigationController } from '../src/hooks/useNavigationController';
import { fetchPedestrianRoute } from '../src/utils/routingProviders';

vi.mock('../src/utils/routingProviders', () => ({ fetchPedestrianRoute: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { fetchPedestrianRoute.mockReset(); });
const origin = { lat: 12.82, lng: 80.04 };
const turn = { lat: 12.821, lng: 80.04 };
const destination = { lat: 12.822, lng: 80.04 };
const route = { path: [origin, turn, destination], steps: [
  { endLocation: turn }, { endLocation: destination },
] };

describe('navigation stability', () => {
  it('animates camera fixes through intermediate positions and cancels on drag', async () => {
    fetchPedestrianRoute.mockResolvedValue(route);
    const frames = new Map();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { frames.set(++id, callback); return id; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn(frame => frames.delete(frame)));
    const map = {
      moveCamera: vi.fn(), getHeading: () => 350,
      getCenter: () => ({ lat: () => origin.lat, lng: () => origin.lng }),
    };
    const { result, rerender } = renderHook(({ position }) => useNavigationController({
      isNavigating: true, destination, liveLocation: position,
      liveHeading: 10, speedMps: 1, mapInstance: map,
    }), { initialProps: { position: origin } });
    await waitFor(() => expect(result.current.activeRoute).toBe(route));
    expect(result.current.autoFollow).toBe(true);
    rerender({ position: turn });
    map.moveCamera.mockClear();
    act(() => frames.get(id)(performance.now() + 200));
    const view = map.moveCamera.mock.calls[0][0];
    expect(view.center.lat).toBeGreaterThan(origin.lat);
    expect(view.center.lat).toBeLessThan(turn.lat);
    expect(view.heading < 15 || view.heading > 345).toBe(true);
    const pending = id;
    act(() => result.current.handleUserMapInteraction());
    expect(cancelAnimationFrame).toHaveBeenCalledWith(pending);
  });

  it('keeps turn progress after rerouting instead of resetting the session', async () => {
    let finishReroute;
    fetchPedestrianRoute.mockResolvedValueOnce(route).mockImplementationOnce(() => new Promise(resolve => { finishReroute = resolve; }));
    const { result, rerender } = renderHook(({ position }) => useNavigationController({
      isNavigating: true, destination, liveLocation: position,
    }), { initialProps: { position: origin } });
    await waitFor(() => expect(result.current.activeRoute).toBe(route));
    rerender({ position: turn });
    expect(result.current.currentStepIndex).toBe(1);
    // A manual reroute after the debounce interval should fetch once, with no
    // extra session-reset fetch when its result lands.
    const later = Date.now() + 7000;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(later);
    act(() => { result.current.retryReroute(); });
    clock.mockRestore();
    await act(async () => finishReroute({ ...route }));
    expect(fetchPedestrianRoute).toHaveBeenCalledTimes(2);
    expect(result.current.currentStepIndex).toBe(1);
  });

  it('ignores a pending route after navigation stops', async () => {
    let finish;
    fetchPedestrianRoute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ enabled }) => useNavigationController({
      isNavigating: enabled, destination, liveLocation: origin,
    }), { initialProps: { enabled: true } });
    expect(fetchPedestrianRoute).toHaveBeenCalledTimes(1);
    expect(typeof finish).toBe('function');
    rerender({ enabled: false });
    await act(async () => finish(route));
    expect(result.current.activeRoute).toBeNull();
    expect(result.current.isRerouting).toBe(false);
  });
});
