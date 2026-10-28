// The offline end of the route lookup (src/utils/routingProviders.js): the online routers get
// OFFLINE_ROUTE_TIMEOUT_MS all together before the campus graph answers, and the campus route
// has no repeated point (which made a phantom 0 m turn before "Arrive") and says where it came
// from, so AR Scan does not draw it as a road through buildings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FROM = { lat: 12.8246, lng: 80.0453 };
const TO = { lat: 12.8233, lng: 80.0444, name: 'JAVA GREEN' };
const MID = { lat: 12.8240, lng: 80.0453 };

// The campus graph's path ends on a node that is the destination itself.
const campus = vi.hoisted(() => ({ path: null }));
vi.mock('../src/data/campusPedestrianGraph', () => ({
  findCampusPedestrianRoute: () => campus.path,
}));

const load = async () => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
  vi.resetModules();
  return import('../src/utils/routingProviders.js');
};

beforeEach(() => {
  campus.path = [FROM, MID, TO, { ...TO }];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('offline route', () => {
  it('a network that never answers gets the campus route after OFFLINE_ROUTE_TIMEOUT_MS, not never', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { fetchPedestrianRoute, OFFLINE_ROUTE_TIMEOUT_MS } = await load();
    expect(OFFLINE_ROUTE_TIMEOUT_MS).toBe(8000);
    let route;
    fetchPedestrianRoute(FROM, TO).then((r) => { route = r; });
    await vi.advanceTimersByTimeAsync(OFFLINE_ROUTE_TIMEOUT_MS - 100);
    expect(route).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(route?.fromCampusGraph).toBe(true);
  });

  it('the campus route has no repeated point and no 0 m turn before Arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const { fetchPedestrianRoute } = await load();
    const route = await fetchPedestrianRoute(FROM, TO);
    expect(route.path).toEqual([FROM, MID, TO]);
    expect(route.fromCampusGraph).toBe(true);
    const turns = route.steps.filter((s) => /^turn|uturn/.test(s.maneuver));
    expect(turns.every((s) => s.distanceMeters > 1)).toBe(true);
    expect(route.steps.slice(0, -1).every((s) => s.distanceMeters > 1)).toBe(true);
  });

  it('an online route is not marked as the campus one', async () => {
    const body = { code: 'Ok', routes: [{ distance: 280, geometry: { coordinates: [[80.0453, 12.8246], [80.0444, 12.8233]] }, legs: [{ steps: [] }] }] };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
    const { fetchPedestrianRoute } = await load();
    const route = await fetchPedestrianRoute(FROM, TO);
    expect(route.fromCampusGraph).toBeUndefined();
  });
});
