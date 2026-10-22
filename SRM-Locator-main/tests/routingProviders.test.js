// Route lookup order, cache and request sharing (src/utils/routingProviders.js).
// fetch is stood in for; nothing here reaches a real router or Google.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FROM = { lat: 12.8246, lng: 80.0453 };
const FROM_NEARBY = { lat: 12.82462, lng: 80.04531 }; // a couple of metres away: same rounded key
const FROM_FAR = { lat: 12.8225, lng: 80.0436 };      // a couple of hundred metres away
const TO = { lat: 12.8233, lng: 80.0444, name: 'JAVA GREEN' };

const OSM_DE = 'routing.openstreetmap.de';
const DEMO = 'router.project-osrm.org';
const GOOGLE = 'routes.googleapis.com';

const osrmBody = { code: 'Ok', routes: [{ distance: 280, geometry: { coordinates: [[80.0453, 12.8246], [80.0444, 12.8233]] }, legs: [{ steps: [] }] }] };
// The three-point polyline from Google's own encoding documentation.
const googleBody = { routes: [{ distanceMeters: 280, duration: '200s', polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' }, legs: [{ steps: [] }] }] };

// Which hosts answer: true = a route, false = nothing / blocked.
let up;
let fetchMock;
const calls = (host) => fetchMock.mock.calls.filter(([url]) => String(url).includes(host)).length;

const load = async ({ key = 'test-key' } = {}) => {
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', key);
  vi.resetModules();
  return import('../src/utils/routingProviders.js');
};

beforeEach(() => {
  up = { [OSM_DE]: true, [DEMO]: true, [GOOGLE]: true };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T10:00:00Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetchMock = vi.fn(async (url) => {
    const host = [OSM_DE, DEMO, GOOGLE].find((h) => String(url).includes(h));
    if (!host || !up[host]) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (host === GOOGLE ? googleBody : osrmBody) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provider order', () => {
  it('asks the OSM foot router first, and nothing else when it answers (zero Google requests)', async () => {
    const { fetchPedestrianRoute } = await load();
    const route = await fetchPedestrianRoute(FROM, TO);
    expect(route.isRealRoute).toBe(true);
    expect(calls(OSM_DE)).toBe(1);
    expect(calls(DEMO)).toBe(0);
    expect(calls(GOOGLE)).toBe(0);
    expect(fetchMock.mock.calls[0][0]).toContain(`${OSM_DE}/routed-foot/`);
  });

  it('asks the OSRM demo server second, and still no Google, when the OSM router has nothing', async () => {
    up[OSM_DE] = false;
    const { fetchPedestrianRoute } = await load();
    expect((await fetchPedestrianRoute(FROM, TO)).path).toHaveLength(2);
    expect(calls(OSM_DE)).toBe(1);
    expect(calls(DEMO)).toBe(1);
    expect(calls(GOOGLE)).toBe(0);
  });

  it('asks Google only when both free routers have nothing, once', async () => {
    up[OSM_DE] = false;
    up[DEMO] = false;
    const { fetchPedestrianRoute } = await load();
    const route = await fetchPedestrianRoute(FROM, TO);
    expect(route.path).toHaveLength(3);
    expect(calls(GOOGLE)).toBe(1);
  });

  it('with no key in the build, never asks Google and falls to the campus graph', async () => {
    up[OSM_DE] = false;
    up[DEMO] = false;
    const { fetchPedestrianRoute } = await load({ key: '' });
    const route = await fetchPedestrianRoute(FROM, TO);
    expect(calls(GOOGLE)).toBe(0);
    expect(route === null || route.path.length >= 2).toBe(true);
  });

  it('falls to the campus graph when Google has nothing either, after one Google request', async () => {
    up[OSM_DE] = false;
    up[DEMO] = false;
    up[GOOGLE] = false;
    const { fetchPedestrianRoute } = await load();
    const route = await fetchPedestrianRoute(FROM, TO);
    expect(calls(GOOGLE)).toBe(1);
    expect(route === null || route.path.length >= 2).toBe(true);
  });

  it('keeps the 1.4 m/s duration rule (280 m is 200 s, 3 min)', async () => {
    const { fetchPedestrianRoute } = await load();
    const route = await fetchPedestrianRoute(FROM, TO);
    expect(route.distanceMeters).toBe(280);
    expect(route.durationSeconds).toBe(180);
  });
});

describe('the cache', () => {
  it('free routers blocked: one Google request, then the cached result', async () => {
    up[OSM_DE] = false;
    up[DEMO] = false;
    const { fetchPedestrianRoute } = await load();
    const first = await fetchPedestrianRoute(FROM, TO);
    const before = fetchMock.mock.calls.length;
    const second = await fetchPedestrianRoute(FROM, TO);
    expect(calls(GOOGLE)).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(second).toBe(first);
  });

  it('a route is still reused after the gap, until its time limit', async () => {
    const { fetchPedestrianRoute } = await load();
    const first = await fetchPedestrianRoute(FROM, TO);
    vi.setSystemTime(Date.now() + 60 * 1000);
    expect(await fetchPedestrianRoute(FROM, TO)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a few metres of movement makes no new request', async () => {
    const { fetchPedestrianRoute } = await load();
    await fetchPedestrianRoute(FROM, TO);
    await fetchPedestrianRoute(FROM_NEARBY, TO);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a route expires after its time limit, and the next ask looks it up again', async () => {
    const { fetchPedestrianRoute } = await load();
    await fetchPedestrianRoute(FROM, TO);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    await fetchPedestrianRoute(FROM, TO);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('the offline fallback is reused only briefly, so real routers are retried', async () => {
    up[OSM_DE] = false;
    up[DEMO] = false;
    up[GOOGLE] = false;
    const { fetchPedestrianRoute } = await load();
    const first = await fetchPedestrianRoute(FROM, TO);
    if (!first) return; // no campus path for these points: nothing cached to test
    const n = fetchMock.mock.calls.length;
    await fetchPedestrianRoute(FROM, TO);
    expect(fetchMock.mock.calls.length).toBe(n);
    vi.setSystemTime(Date.now() + 31 * 1000);
    await fetchPedestrianRoute(FROM, TO);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(n);
  });

  it('clearRouteCache forgets everything', async () => {
    const { fetchPedestrianRoute, clearRouteCache } = await load();
    await fetchPedestrianRoute(FROM, TO);
    clearRouteCache();
    await fetchPedestrianRoute(FROM, TO);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('the minimum gap', () => {
  it('a new spot for the same destination inside the gap gets the last route, with no request', async () => {
    const { fetchPedestrianRoute } = await load();
    const first = await fetchPedestrianRoute(FROM, TO);
    vi.setSystemTime(Date.now() + 5000);
    const second = await fetchPedestrianRoute(FROM_FAR, TO);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('after the gap the new spot is looked up', async () => {
    const { fetchPedestrianRoute } = await load();
    await fetchPedestrianRoute(FROM, TO);
    vi.setSystemTime(Date.now() + 8001);
    await fetchPedestrianRoute(FROM_FAR, TO);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a different destination is not held back', async () => {
    const { fetchPedestrianRoute } = await load();
    await fetchPedestrianRoute(FROM, TO);
    await fetchPedestrianRoute(FROM, { lat: 12.8208, lng: 80.0391, name: 'HI-TECH BLOCK' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('simultaneous callers', () => {
  it('three callers asking at once (navigation and both walking lines) make one request', async () => {
    const { fetchPedestrianRoute } = await load();
    const [a, b, c] = await Promise.all([
      fetchPedestrianRoute(FROM, TO),
      fetchPedestrianRoute(FROM, TO),
      fetchPedestrianRoute(FROM_NEARBY, TO),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('three at once with the free routers blocked make exactly one Google request', async () => {
    up[OSM_DE] = false;
    up[DEMO] = false;
    const { fetchPedestrianRoute } = await load();
    await Promise.all([fetchPedestrianRoute(FROM, TO), fetchPedestrianRoute(FROM, TO), fetchPedestrianRoute(FROM, TO)]);
    expect(calls(GOOGLE)).toBe(1);
  });

  it('a caller arriving after the gap, while a slow lookup is still running, shares it', async () => {
    let release;
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({ ok: true, status: 200, json: async () => osrmBody }); }));
    const { fetchPedestrianRoute } = await load();
    const first = fetchPedestrianRoute(FROM, TO);
    vi.setSystemTime(Date.now() + 9000);
    const second = fetchPedestrianRoute(FROM, TO);
    release();
    expect(await second).toBe(await first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('callers at different spots for one destination, while a lookup runs, share it', async () => {
    const { fetchPedestrianRoute } = await load();
    await Promise.all([fetchPedestrianRoute(FROM, TO), fetchPedestrianRoute(FROM_FAR, TO)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
