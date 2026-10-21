import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AMBIGUOUS_FLOOR_WEIGHT,
  FULL_CONFIDENCE_AP_COUNT,
  __resetAccessPointCache,
  estimatePosition,
  estimateWifiPosition,
  loadAccessPoints,
  mergeScans,
  refreshAccessPoints,
  rssiWeight,
} from '../src/utils/wifiPositioning.js';

// Firestore and Auth are mocked: the estimator is pure, and the cache tests only need to
// see how often wifi_aps is read and what happens around sign-in.
const firebase = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'u1' }, authStateReady: vi.fn(() => Promise.resolve()) },
  getDocsFromServer: vi.fn(),
}));
vi.mock('../src/firebase.js', () => ({ auth: firebase.auth, db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ path: name }),
  getDocsFromServer: firebase.getDocsFromServer,
}));

// Coordinates from the real TECH PARK survey, a few metres apart.
const P1 = { lat: 12.824813, lng: 80.044965 };
const P2 = { lat: 12.824954, lng: 80.04541 };
const P3 = { lat: 12.82499, lng: 80.045143 };

const ap = (at, floor, ambiguousFloor = false, building = 'TECH PARK') => ({ ...at, building, floor, ambiguousFloor });
const table = (entries) => new Map(Object.entries(entries));
const scan = (readings) => Object.entries(readings).map(([bssid, rssi]) => ({ bssid, ssid: 'SRMIST', rssi, frequency: 2437 }));

// Weighted centroid, written out independently of the module's own loop.
const centroid = (points) => {
  const total = points.reduce((s, p) => s + p.w, 0);
  return {
    lat: points.reduce((s, p) => s + p.lat * p.w, 0) / total,
    lng: points.reduce((s, p) => s + p.lng * p.w, 0) / total,
  };
};

describe('rssiWeight', () => {
  it('doubles every 10 dB, from 1 at -100 dBm', () => {
    expect(rssiWeight(-100)).toBe(1);
    expect(rssiWeight(-70)).toBe(8);
    expect(rssiWeight(-40)).toBe(64);
    expect(rssiWeight(-65)).toBeGreaterThan(rssiWeight(-66));
  });
});

describe('mergeScans', () => {
  it('keeps the strongest reading per BSSID across scans, not an average', () => {
    const merged = mergeScans([scan({ a: -80, b: -60 }), scan({ a: -50, c: -70 }), scan({ a: -90 })]);
    expect(merged).toEqual(new Map([['a', -50], ['b', -60], ['c', -70]]));
  });

  it('lowercases BSSIDs so they match the wifi_aps document IDs', () => {
    expect(mergeScans([[{ bssid: 'AA:BB:CC:DD:EE:FF', rssi: -60 }]])).toEqual(new Map([['aa:bb:cc:dd:ee:ff', -60]]));
  });

  it('accepts whole scan results, and skips ones without aps and unusable entries', () => {
    const merged = mergeScans([
      { outcome: 'fresh', aps: scan({ a: -60 }) },
      { outcome: 'throttled' },
      undefined,
      [{ bssid: 'b' }, { rssi: -50 }, null, { bssid: 'c', rssi: NaN }],
    ]);
    expect(merged).toEqual(new Map([['a', -60]]));
  });
});

describe('estimatePosition', () => {
  it('clean single-floor match: that floor, the weighted centroid, full confidence', () => {
    const aps = table({ a: ap(P1, 1), b: ap(P2, 1), c: ap(P3, 1), d: ap(P1, 1), e: ap(P2, 1) });
    const result = estimatePosition([scan({ a: -50, b: -60, c: -70, d: -80, e: -90 })], aps);

    const expected = centroid([
      { ...P1, w: rssiWeight(-50) },
      { ...P2, w: rssiWeight(-60) },
      { ...P3, w: rssiWeight(-70) },
      { ...P1, w: rssiWeight(-80) },
      { ...P2, w: rssiWeight(-90) },
    ]);
    expect(result.building).toBe('TECH PARK');
    expect(result.floor).toBe(1);
    expect(result.lat).toBeCloseTo(expected.lat, 9);
    expect(result.lng).toBeCloseTo(expected.lng, 9);
    expect(result.matchedApCount).toBe(5);
    expect(result.totalApsSeen).toBe(5);
    expect(result.confidence).toBeCloseTo(1, 9);
  });

  it('pulls the centroid toward the stronger AP', () => {
    const aps = table({ a: ap(P1, 0), b: ap(P2, 0) });
    const nearP1 = estimatePosition([scan({ a: -40, b: -90 })], aps);
    const nearP2 = estimatePosition([scan({ a: -90, b: -40 })], aps);
    expect(Math.abs(nearP1.lat - P1.lat)).toBeLessThan(Math.abs(nearP1.lat - P2.lat));
    expect(Math.abs(nearP2.lat - P2.lat)).toBeLessThan(Math.abs(nearP2.lat - P1.lat));
  });

  it('near-tie between two floors: visibly lower confidence than a decisive match', () => {
    const aps = table({
      a: ap(P1, 1), b: ap(P2, 1), c: ap(P3, 1),
      d: ap(P1, 2), e: ap(P2, 2), f: ap(P3, 2),
    });
    // Floor 1 edges it by 1 dB on one AP.
    const tie = estimatePosition([scan({ a: -60, b: -65, c: -70, d: -61, e: -65, f: -70 })], aps);
    // Same APs and floor-1 readings, but floor 2 barely heard.
    const decisive = estimatePosition([scan({ a: -60, b: -65, c: -70, d: -100, e: -100, f: -100 })], aps);

    expect(tie.floor).toBe(1);
    expect(decisive.floor).toBe(1);
    expect(tie.matchedApCount).toBe(decisive.matchedApCount);
    expect(tie.confidence).toBeGreaterThan(0.45);
    expect(tie.confidence).toBeLessThan(0.55);
    expect(decisive.confidence).toBeGreaterThan(0.9);
  });

  it('an exact tie is settled the same way every time: the lower floor', () => {
    const aps = table({ a: ap(P1, 2), b: ap(P2, 1) });
    expect(estimatePosition([scan({ a: -60, b: -60 })], aps).floor).toBe(1);
    expect(estimatePosition([scan({ b: -60, a: -60 })], aps).floor).toBe(1);
  });

  it('a single matched AP is low confidence even with nothing disagreeing', () => {
    const result = estimatePosition([scan({ a: -40 })], table({ a: ap(P1, 2) }));
    expect(result.floor).toBe(2);
    expect(result.matchedApCount).toBe(1);
    expect(result.confidence).toBeCloseTo(1 / FULL_CONFIDENCE_AP_COUNT, 9);
  });

  it('confidence rises with matched APs, and stops rising past the cap', () => {
    const aps = table(Object.fromEntries('abcdefg'.split('').map((id) => [id, ap(P1, 0)])));
    const confidenceWith = (n) =>
      estimatePosition([scan(Object.fromEntries('abcdefg'.slice(0, n).split('').map((id) => [id, -60])))], aps).confidence;
    expect(confidenceWith(1)).toBeLessThan(confidenceWith(3));
    expect(confidenceWith(3)).toBeLessThan(confidenceWith(5));
    expect(confidenceWith(7)).toBeCloseTo(confidenceWith(5), 9);
  });

  it('all-ambiguous: same floor and same lat/lng as trusted APs, but half the confidence', () => {
    const readings = scan({ a: -55, b: -60, c: -65, d: -70, e: -75 });
    const floors = { a: 0, b: 0, c: 0, d: 1, e: 0 };
    const at = { a: P1, b: P2, c: P3, d: P1, e: P2 };
    const trusted = estimatePosition(
      [readings],
      table(Object.fromEntries(Object.keys(floors).map((id) => [id, ap(at[id], floors[id], false)])))
    );
    const ambiguous = estimatePosition(
      [readings],
      table(Object.fromEntries(Object.keys(floors).map((id) => [id, ap(at[id], floors[id], true)])))
    );

    expect(ambiguous.floor).toBe(0);
    expect(ambiguous.floor).toBe(trusted.floor);
    expect(ambiguous.lat).toBe(trusted.lat);
    expect(ambiguous.lng).toBe(trusted.lng);
    expect(ambiguous.matchedApCount).toBe(5);
    expect(ambiguous.confidence).toBeCloseTo(trusted.confidence * AMBIGUOUS_FLOOR_WEIGHT, 9);
  });

  it('down-weights an ambiguous AP in the floor vote only, not in the centroid', () => {
    // Heard more strongly than the trusted AP: at full weight its floor would win.
    const aps = table({ trusted: ap(P1, 1), shaky: ap(P2, 2, true) });
    const result = estimatePosition([scan({ trusted: -60, shaky: -55 })], aps);

    expect(rssiWeight(-55)).toBeGreaterThan(rssiWeight(-60));
    expect(rssiWeight(-55) * AMBIGUOUS_FLOOR_WEIGHT).toBeLessThan(rssiWeight(-60));
    expect(result.floor).toBe(1);

    const expected = centroid([
      { ...P1, w: rssiWeight(-60) },
      { ...P2, w: rssiWeight(-55) }, // full weight
    ]);
    expect(result.lat).toBeCloseTo(expected.lat, 9);
    expect(result.lng).toBeCloseTo(expected.lng, 9);
  });

  it('never pools the same floor number across buildings', () => {
    // Heard from TECH PARK floor 2 most strongly. The two floor-1 APs are in DIFFERENT
    // buildings: pooled by floor number alone they would outvote it (2 x 11.3 > 16).
    const aps = table({
      tp2: ap(P1, 2, false, 'TECH PARK'),
      tp1: ap(P2, 1, false, 'TECH PARK'),
      ub1: ap(P3, 1, false, 'UNIVERSITY BUILDING'),
    });
    const result = estimatePosition([scan({ tp2: -60, tp1: -65, ub1: -65 })], aps);

    expect(result.building).toBe('TECH PARK');
    expect(result.floor).toBe(2);
    // The two buildings' floor 1 split the doubt between them: share 16 / 38.6.
    const total = rssiWeight(-60) + 2 * rssiWeight(-65);
    expect(result.confidence).toBeCloseTo((3 / FULL_CONFIDENCE_AP_COUNT) * (rssiWeight(-60) / total), 9);
  });

  it('still pools one building\'s floor across its APs', () => {
    const aps = table({
      tp2: ap(P1, 2, false, 'TECH PARK'),
      tp1a: ap(P2, 1, false, 'TECH PARK'),
      tp1b: ap(P3, 1, false, 'TECH PARK'),
    });
    expect(estimatePosition([scan({ tp2: -60, tp1a: -65, tp1b: -65 })], aps)).toMatchObject({ building: 'TECH PARK', floor: 1 });
  });

  it('settles an exact tie between buildings the same way every time', () => {
    const aps = table({ a: ap(P1, 1, false, 'UNIVERSITY BUILDING'), b: ap(P2, 1, false, 'TECH PARK') });
    const forward = estimatePosition([scan({ a: -60, b: -60 })], aps);
    const reverse = estimatePosition([scan({ b: -60, a: -60 })], aps);
    expect(forward).toMatchObject({ building: 'TECH PARK', floor: 1 });
    expect(reverse).toMatchObject({ building: 'TECH PARK', floor: 1 });
  });

  it('lets an outdoor AP (no building or floor) vote for "outdoors" and still place the centroid', () => {
    const result = estimatePosition([scan({ out: -50, in: -80 })], table({ out: ap(P1, null, false, null), in: ap(P2, 0) }));
    expect(result.building).toBeNull();
    expect(result.floor).toBeNull();
    expect(result.lat).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('ignores APs that are not in wifi_aps: same answer with or without them', () => {
    const aps = table({ a: ap(P1, 1), b: ap(P2, 1) });
    const clean = estimatePosition([scan({ a: -60, b: -70 })], aps);
    const withHotspots = estimatePosition([scan({ a: -60, b: -70, hotspot: -30, 'far-away': -85 })], aps);

    expect(withHotspots).toEqual({ ...clean, totalApsSeen: 4 });
    expect(clean.totalApsSeen).toBe(2);
  });

  it('merges multiple thin scans into one estimate, strongest reading wins', () => {
    const aps = table({ a: ap(P1, 1), b: ap(P2, 1), c: ap(P3, 2) });
    // Three thin scans, each missing something, one reading of `a` much stronger.
    const merged = estimatePosition([scan({ a: -80, c: -75 }), scan({ a: -50 }), scan({ b: -65, c: -90 })], aps);
    // Listed in the order the merge first meets each BSSID, so the float sums match exactly.
    const single = estimatePosition([scan({ a: -50, c: -75, b: -65 })], aps);

    expect(merged).toEqual(single);
    expect(merged.matchedApCount).toBe(3);
    expect(merged.totalApsSeen).toBe(3);
    // A lone scan with only the weak reading of `a` would score lower.
    expect(estimatePosition([scan({ a: -80, c: -75 })], aps).confidence).toBeLessThan(merged.confidence);
  });

  it('no match at all is a clean zero-confidence result, never a throw', () => {
    const aps = table({ a: ap(P1, 1) });
    const empty = { lat: null, lng: null, building: null, floor: null, confidence: 0, matchedApCount: 0 };

    expect(estimatePosition([], aps)).toEqual({ ...empty, totalApsSeen: 0 });
    expect(estimatePosition([[]], aps)).toEqual({ ...empty, totalApsSeen: 0 });
    expect(estimatePosition([{ outcome: 'timeout' }], aps)).toEqual({ ...empty, totalApsSeen: 0 });
    expect(estimatePosition([scan({ hotspot: -40, other: -70 })], aps)).toEqual({ ...empty, totalApsSeen: 2 });
    expect(estimatePosition([scan({ a: -60 })], new Map())).toEqual({ ...empty, totalApsSeen: 1 });
    expect(estimatePosition(undefined, aps)).toEqual({ ...empty, totalApsSeen: 0 });
  });
});

describe('wifi_aps cache', () => {
  const doc = (id, data) => ({ id, data: () => data });
  const seeded = (docs) => ({ docs });
  const SEED = [
    doc('aa:aa:aa:aa:aa:01', { bssid: 'aa:aa:aa:aa:aa:01', lat: P1.lat, lng: P1.lng, building: 'TECH PARK', floor: 1, ambiguousFloor: false, rssi: -60 }),
    doc('aa:aa:aa:aa:aa:02', { bssid: 'aa:aa:aa:aa:aa:02', lat: P2.lat, lng: P2.lng, building: 'TECH PARK', floor: 2, ambiguousFloor: true, rssi: -70 }),
  ];

  beforeEach(() => {
    __resetAccessPointCache();
    firebase.getDocsFromServer.mockReset();
    firebase.auth.authStateReady.mockClear();
    firebase.auth.currentUser = { uid: 'u1' };
  });

  it('reads wifi_aps once, then answers every estimate from memory', async () => {
    firebase.getDocsFromServer.mockResolvedValue(seeded(SEED));

    const first = await estimateWifiPosition([scan({ 'aa:aa:aa:aa:aa:01': -60 })]);
    await estimateWifiPosition([scan({ 'aa:aa:aa:aa:aa:02': -60 })]);
    await estimateWifiPosition([scan({ unknown: -60 })]);

    expect(firebase.getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(firebase.getDocsFromServer.mock.calls[0][0]).toEqual({ path: 'wifi_aps' });
    expect(first).toMatchObject({ building: 'TECH PARK', floor: 1, matchedApCount: 1 });
  });

  it('shares one read between callers that arrive while it is in flight', async () => {
    firebase.getDocsFromServer.mockResolvedValue(seeded(SEED));
    const [a, b] = await Promise.all([loadAccessPoints(), loadAccessPoints()]);
    expect(a).toBe(b);
    expect(firebase.getDocsFromServer).toHaveBeenCalledTimes(1);
  });

  it('refreshAccessPoints re-reads, and later estimates use the new table', async () => {
    firebase.getDocsFromServer.mockResolvedValueOnce(seeded(SEED));
    await loadAccessPoints();

    const moved = doc('aa:aa:aa:aa:aa:01', { lat: P3.lat, lng: P3.lng, floor: 7, ambiguousFloor: false });
    firebase.getDocsFromServer.mockResolvedValueOnce(seeded([moved]));
    await refreshAccessPoints();

    const result = await estimateWifiPosition([scan({ 'aa:aa:aa:aa:aa:01': -60, 'aa:aa:aa:aa:aa:02': -60 })]);
    expect(firebase.getDocsFromServer).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ floor: 7, lat: P3.lat, matchedApCount: 1, totalApsSeen: 2 });
  });

  it('never caches a failed read: the next call tries again', async () => {
    firebase.getDocsFromServer.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(loadAccessPoints()).rejects.toMatchObject({ code: 'unavailable' });

    firebase.getDocsFromServer.mockResolvedValueOnce(seeded(SEED));
    await expect(loadAccessPoints()).resolves.toHaveProperty('size', 2);
    expect(firebase.getDocsFromServer).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous table when a refresh fails', async () => {
    firebase.getDocsFromServer.mockResolvedValueOnce(seeded(SEED));
    const before = await loadAccessPoints();

    firebase.getDocsFromServer.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(refreshAccessPoints()).rejects.toMatchObject({ code: 'unavailable' });

    expect(await loadAccessPoints()).toBe(before);
    expect(firebase.getDocsFromServer).toHaveBeenCalledTimes(2);
  });

  it('waits for Firebase to restore the session before reading', async () => {
    let restore;
    firebase.auth.currentUser = null;
    firebase.auth.authStateReady.mockImplementationOnce(
      () => new Promise((resolve) => (restore = () => { firebase.auth.currentUser = { uid: 'u1' }; resolve(); }))
    );
    firebase.getDocsFromServer.mockResolvedValue(seeded(SEED));

    const pending = loadAccessPoints();
    await Promise.resolve();
    expect(firebase.getDocsFromServer).not.toHaveBeenCalled();

    restore();
    await expect(pending).resolves.toHaveProperty('size', 2);
    expect(firebase.getDocsFromServer).toHaveBeenCalledTimes(1);
  });

  it('refuses without a signed-in user and never queries Firestore', async () => {
    firebase.auth.currentUser = null;
    await expect(estimateWifiPosition([scan({ 'aa:aa:aa:aa:aa:01': -60 })])).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(firebase.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('skips malformed documents and reads a missing ambiguousFloor as ambiguous', async () => {
    firebase.getDocsFromServer.mockResolvedValue(
      seeded([
        doc('AA:AA:AA:AA:AA:01', { lat: P1.lat, lng: P1.lng, building: 'TECH PARK', floor: 1 }), // no ambiguousFloor
        doc('bb:bb:bb:bb:bb:01', { lat: 'x', lng: P1.lng, building: 'TECH PARK', floor: 1, ambiguousFloor: false }),
        doc('bb:bb:bb:bb:bb:02', { lat: P1.lat, lng: P1.lng, building: 'TECH PARK', floor: 1.5, ambiguousFloor: false }),
        doc('bb:bb:bb:bb:bb:03', { building: 'TECH PARK', floor: 1, ambiguousFloor: false }),
        doc('bb:bb:bb:bb:bb:04', { lat: P1.lat, lng: P1.lng, building: 42, floor: 1, ambiguousFloor: false }),
        doc('cc:cc:cc:cc:cc:01', { lat: P2.lat, lng: P2.lng, ambiguousFloor: false }), // outdoors
      ])
    );
    const aps = await loadAccessPoints();

    expect([...aps.keys()].sort()).toEqual(['aa:aa:aa:aa:aa:01', 'cc:cc:cc:cc:cc:01']);
    expect(aps.get('aa:aa:aa:aa:aa:01')).toMatchObject({ building: 'TECH PARK', floor: 1, ambiguousFloor: true });
    expect(aps.get('cc:cc:cc:cc:cc:01')).toMatchObject({ building: null, floor: null });
  });
});
