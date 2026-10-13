import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WIFI_CONFIDENCE_THRESHOLD } from '../src/utils/positionSource.js';
import { inWalkable, pathCrossesWall } from '../src/utils/floorGeometry.js';
import { toGeo, toLocal } from '../src/utils/floor7Frame.js';
import { floor7Plan } from '../src/utils/floor7Plan.js';
import { estimatePosition } from '../src/utils/wifiPositioning.js';
import { startWifiFusion } from '../src/utils/wifiFusion.js';
import floor7Aps from '../src/data/floor7Aps.json';
import { __resetAccessPointCache, loadAccessPoints } from '../src/utils/wifiPositioning.js';
import {
  DEMO_BUILDING, DEMO_FLOOR, HALO_FULL_UNCERTAINTY_M, confidenceFromUncertainty, createFloor7Tracker,
  floor7AccessPointTable, floor7FusionOptions, floor7Spots, getTrail, subscribeTrail,
} from '../src/utils/floor7Demo.js';

vi.mock('../src/firebase.js', () => ({ auth: {}, db: {} }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), getDocsFromServer: vi.fn() }));

const STEP = 35_000;
const T0 = 1_700_000_000_000;
const SPOTS = floor7Spots;
const atSpot = (name) => toGeo(SPOTS[name].x, SPOTS[name].y);
const estimateAt = (name, confidence = 0.9, extra = {}) => ({
  ...atSpot(name), building: DEMO_BUILDING, floor: DEMO_FLOOR, confidence, matchedApCount: 5, totalApsSeen: 8, ...extra,
});

describe('the Floor 7 plan data', () => {
  it('has the 23 surveyed spots of the plan, every one in walkable space', () => {
    expect(Object.keys(SPOTS)).toHaveLength(23);
    for (const [name, p] of Object.entries(SPOTS)) expect(inWalkable(p, floor7Plan.walkable), name).toBe(true);
  });

  it('has walls between a room and the corridor, with the doorway left open', () => {
    // Room 702's own wall lies between its middle and the west spine...
    expect(pathCrossesWall({ x: -14.2, y: 3 }, { x: -9, y: 3 }, floor7Plan.walls)).toBe(true);
    // ...but its doorway (y 4.8 to 5.7) is a gap, and the passage is open end to end.
    expect(pathCrossesWall({ x: -14.2, y: 5.25 }, { x: -9, y: 5.25 }, floor7Plan.walls)).toBe(false);
    expect(pathCrossesWall({ x: -9, y: 0 }, { x: 37, y: 0 }, floor7Plan.walls)).toBe(false);
  });

  it('counts only corridors and lift lobbies as walkable: a room is not', () => {
    expect(inWalkable({ x: -14.2, y: 3 }, floor7Plan.walkable)).toBe(false);
    expect(inWalkable({ x: -9, y: 3 }, floor7Plan.walkable)).toBe(true);
  });
});

describe('the bundled access points', () => {
  const table = floor7AccessPointTable();

  it('has every BSSID of every radio, all on TECH PARK Floor 7', () => {
    const count = floor7Aps.radios.reduce((n, r) => n + r.bssids.length, 0);
    expect(table.size).toBe(count);
    for (const ap of table.values()) expect(ap).toMatchObject({ building: 'TECH PARK', floor: 7, ambiguousFloor: false });
  });

  it('puts an access point at its radio\'s position in the Floor 7 frame', () => {
    const radio = floor7Aps.radios[0];
    const ap = table.get(radio.bssids[0].bssid);
    const local = toLocal(ap.lat, ap.lng);
    expect(local.x).toBeCloseTo(radio.x, 6);
    expect(local.y).toBeCloseTo(radio.y, 6);
  });

  it('applies PLAN_SCALE to every position, as the plan itself does', () => {
    const radio = floor7Aps.radios[0];
    const doubled = floor7AccessPointTable(floor7Aps, 2).get(radio.bssids[0].bssid);
    const local = toLocal(doubled.lat, doubled.lng);
    expect(local.x).toBeCloseTo(2 * radio.x, 6);
    expect(local.y).toBeCloseTo(2 * radio.y, 6);
  });

  it('feeds the real estimator: hearing only a radio places you at that radio', () => {
    const radio = floor7Aps.radios[0];
    const scans = [radio.bssids.map(({ bssid }) => ({ bssid, rssi: -50 }))];
    const est = estimatePosition(scans, table);
    expect(est).toMatchObject({ building: 'TECH PARK', floor: 7 });
    const local = toLocal(est.lat, est.lng);
    expect(local.x).toBeCloseTo(radio.x, 5);
    expect(local.y).toBeCloseTo(radio.y, 5);
  });
});

describe('starting the demo', () => {
  afterEach(() => __resetAccessPointCache());

  it('installs the bundled access points in place of wifi_aps, and hands back a working tracker', async () => {
    const options = floor7FusionOptions();
    expect((await loadAccessPoints()).size).toBe(floor7AccessPointTable().size);
    expect(typeof options.tracker.apply).toBe('function');
    expect(options.tracker.apply(estimateAt('Room 706'), T0).filterStatus).toBe('tracking');
  });
});

describe('the Floor 7 tracker', () => {
  let tracker;
  beforeEach(() => {
    tracker = createFloor7Tracker({ staleMs: 70_000 });
    tracker.reset();
  });

  it('leaves an estimate for another building or floor, or without a position, alone', () => {
    const other = { ...estimateAt('Room 706'), floor: 3 };
    expect(tracker.apply(other, T0)).toBe(other);
    const elsewhere = { ...estimateAt('Room 706'), building: 'MAIN BLOCK' };
    expect(tracker.apply(elsewhere, T0)).toBe(elsewhere);
    const none = { lat: null, lng: null, building: 'TECH PARK', floor: 7, confidence: 0 };
    expect(tracker.apply(none, T0)).toBe(none);
    expect(getTrail()).toHaveLength(0);
  });

  it('takes the first estimate as is and reports the filter state with it', () => {
    const out = tracker.apply(estimateAt('Room 706'), T0);
    expect(out.lat).toBeCloseTo(estimateAt('Room 706').lat, 9);
    expect(out.filterStatus).toBe('tracking');
    expect(out.rawConfidence).toBe(0.9);
  });

  it('rejects an estimate 30 m away on the very next scan, and keeps the old position', () => {
    const first = tracker.apply(estimateAt('Room 706'), T0);
    const out = tracker.apply(estimateAt('Room 703'), T0 + STEP); // 46 m across the floor
    expect(out.filterStatus).toBe('rejected');
    expect(out.lat).toBeCloseTo(first.lat, 9);
    expect(out.lng).toBeCloseTo(first.lng, 9);
  });

  it('never lets confidence fall below the WiFi threshold while it holds a position, so GPS cannot take over', () => {
    const out = tracker.apply(estimateAt('Room 706', 0.2), T0);
    expect(out.confidence).toBeGreaterThanOrEqual(WIFI_CONFIDENCE_THRESHOLD);
  });

  it('shows a smaller halo (higher confidence) as the filter becomes surer', () => {
    expect(confidenceFromUncertainty(0)).toBe(1);
    expect(confidenceFromUncertainty(HALO_FULL_UNCERTAINTY_M)).toBe(0);
    expect(confidenceFromUncertainty(5)).toBeGreaterThan(confidenceFromUncertainty(10));
    expect(confidenceFromUncertainty(500)).toBe(0);
  });

  it('records a trail of raw and filtered positions for the overlay, and tells subscribers', () => {
    const seen = vi.fn();
    const off = subscribeTrail(seen);
    tracker.apply(estimateAt('Room 706'), T0);
    tracker.apply(estimateAt('Room 706'), T0 + STEP);
    off();
    tracker.apply(estimateAt('Room 706'), T0 + 2 * STEP);
    expect(seen).toHaveBeenCalledTimes(2);
    const trail = getTrail();
    expect(trail).toHaveLength(3);
    expect(trail[0]).toMatchObject({ status: 'tracking' });
    expect(trail[0].raw.x).toBeCloseTo(SPOTS['Room 706'].x, 6);
    expect(trail[0].snapped.x).toBeCloseTo(SPOTS['Room 706'].x, 6); // already on a centreline: snapping moves nothing
    expect(trail[0].filtered).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
  });

  it('records where the raw estimate snaps to on the corridor, for the overlay', () => {
    const inRoom = toGeo(-14.2, 11.75); // the middle of Room 701
    tracker.apply({ ...estimateAt('Room 706'), ...inRoom }, T0);
    const { raw, snapped } = getTrail()[0];
    expect(raw.x).toBeCloseTo(-14.2, 6);
    expect(snapped.x).toBeCloseTo(-9, 6);
    expect(snapped.y).toBeCloseTo(11.75, 6);
  });

  it('keeps only the most recent steps', () => {
    for (let i = 0; i < 100; i++) tracker.apply(estimateAt('Room 706'), T0 + i * STEP);
    expect(getTrail().length).toBeLessThanOrEqual(60);
    expect(getTrail().at(-1).at).toBe(T0 + 99 * STEP);
  });

  it('reset() clears the trail and the filter', () => {
    tracker.apply(estimateAt('Room 706'), T0);
    tracker.reset();
    expect(getTrail()).toHaveLength(0);
    const out = tracker.apply(estimateAt('Room 703'), T0 + STEP); // taken as is, not rejected
    expect(out.filterStatus).toBe('tracking');
  });
});

describe('the tracker inside the fusion loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  const AP = { bssid: 'aa:bb:cc:dd:ee:01', ssid: 'SRMIST', rssi: -55, frequency: 5180 };

  it('shows the filtered position, and keeps WiFi in charge when the raw confidence is low', async () => {
    const tracker = createFloor7Tracker();
    tracker.reset();
    const estimates = [estimateAt('Room 706', 0.9), estimateAt('Room 706', 0.2)];
    const fusion = startWifiFusion({
      isAvailable: () => true,
      scan: async () => ({ outcome: 'fresh', accepted: true, aps: [AP] }),
      estimate: async () => estimates.shift(),
      floorsFor: async () => [7],
      tracker,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fusion.resolve({ lat: 1, lng: 2 }).positionSource).toBe('wifi');
    await vi.advanceTimersByTimeAsync(35_000);
    // The second raw estimate is only 0.2 confident: without the tracker GPS would win here.
    const out = fusion.resolve({ lat: 1, lng: 2 });
    expect(out.positionSource).toBe('wifi');
    expect(out.lat).toBeCloseTo(atSpot('Room 706').lat, 5);
    expect(fusion.indoor()).toMatchObject({ building: 'TECH PARK', floor: 7 });
    fusion.stop();
  });

  it('without a tracker (every other build) the estimate is exactly what Stage 5 produced', async () => {
    const fusion = startWifiFusion({
      isAvailable: () => true,
      scan: async () => ({ outcome: 'fresh', accepted: true, aps: [AP] }),
      estimate: async () => estimateAt('Room 706', 0.2),
      floorsFor: async () => [7],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fusion.resolve({ lat: 1, lng: 2 }).positionSource).toBe('gps');
    fusion.stop();
  });
});
