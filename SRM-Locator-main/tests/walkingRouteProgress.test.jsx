// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useWalkingRoute } from '../src/hooks/useWalkingRoute';
import { fetchOsrmWalkingRoute } from '../src/utils/routingProviders';

vi.mock('../src/utils/routingProviders', () => ({
  fetchOsrmWalkingRoute: vi.fn(), fetchGoogleWalkingRoute: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const start = { lat: 12.82, lng: 80.04 };
const corner = { lat: 12.8201, lng: 80.04 };
const end = { lat: 12.8201, lng: 80.0401 };

describe('walking route progress', () => {
  it('removes travelled segments on each fix without waiting for a new route request', async () => {
    fetchOsrmWalkingRoute.mockResolvedValue({ path: [start, corner, end], isRealRoute: true });
    const { result, rerender } = renderHook(({ position }) => useWalkingRoute({
      engine: 'leaflet', liveLocation: position, activeWaypoint: end,
    }), { initialProps: { position: start } });
    await waitFor(() => expect(result.current.isRealRoute).toBe(true));
    const halfway = { lat: 12.82005, lng: 80.04 };
    rerender({ position: halfway });
    expect(result.current.path[0].lat).toBeCloseTo(halfway.lat, 8);
    expect(result.current.path.slice(1)).toEqual([corner, end]);
    const afterCorner = { lat: 12.8201, lng: 80.04005 };
    rerender({ position: afterCorner });
    expect(result.current.path[0].lng).toBeCloseTo(afterCorner.lng, 8);
    expect(result.current.path.slice(1)).toEqual([end]);
    expect(result.current.path).not.toContainEqual(start);
    expect(result.current.path).not.toContainEqual(corner);
    expect(fetchOsrmWalkingRoute).toHaveBeenCalledTimes(1);
  });
});
