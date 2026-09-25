import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WIFI_CONFIDENCE_THRESHOLD,
  WIFI_ESTIMATE_MAX_AGE_MS,
  WIFI_SCAN_BUFFER_SIZE,
  WIFI_SCAN_INTERVAL_MS,
  WIFI_SCAN_MAX_AGE_MS,
  choosePosition,
  indoorReading,
  startWifiFusion,
} from '../src/utils/wifiFusion.js';
import { SCAN_LIMIT, SCAN_WINDOW_MS } from '../src/utils/wifiScan.js';

// wifiFusion imports the real Stage 5 module; its Firebase side is never reached here
// (every test injects `estimate`), but the import must not pull in a live SDK.
vi.mock('../src/firebase.js', () => ({ auth: {}, db: {} }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), getDocsFromServer: vi.fn() }));

const GPS = { lat: 12.8231, lng: 80.0442 };
const WIFI = { lat: 12.824813, lng: 80.044965 };
const AP = { bssid: 'aa:bb:cc:dd:ee:01', ssid: 'SRMIST', rssi: -55, frequency: 5180 };

const estimateOf = (confidence) => ({
  ...WIFI,
  building: 'TECH PARK',
  floor: 1,
  confidence,
  matchedApCount: 4,
  totalApsSeen: 6,
});
const fresh = (aps = [AP]) => ({ outcome: 'fresh', accepted: true, aps });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

/** A controller on fake timers, with the first (immediate) cycle already settled. */
async function start(overrides) {
  const fusion = startWifiFusion({ isAvailable: () => true, ...overrides });
  await vi.advanceTimersByTimeAsync(0);
  return fusion;
}

describe('the v1 switch', () => {
  it('uses WiFi at or above the threshold, GPS below it', () => {
    expect(choosePosition(GPS, estimateOf(0.6))).toEqual({ ...WIFI, positionSource: 'wifi' });
    expect(choosePosition(GPS, estimateOf(0.95))).toEqual({ ...WIFI, positionSource: 'wifi' });
    expect(choosePosition(GPS, estimateOf(0.59))).toEqual({ ...GPS, positionSource: 'gps' });
  });

  it('uses GPS when there is no estimate, or one without a position', () => {
    expect(choosePosition(GPS, null)).toEqual({ ...GPS, positionSource: 'gps' });
    expect(choosePosition(GPS, { ...estimateOf(1), lat: null, lng: null })).toEqual({ ...GPS, positionSource: 'gps' });
  });

  it('only ever answers gps or wifi - never fused, never undefined', () => {
    const estimates = [null, undefined, {}, estimateOf(0), estimateOf(0.6), estimateOf(1), { confidence: NaN }];
    for (const e of estimates) {
      expect(['gps', 'wifi']).toContain(choosePosition(GPS, e).positionSource);
    }
  });

  it('ships the stated v1 constants', () => {
    expect(WIFI_CONFIDENCE_THRESHOLD).toBe(0.6);
    expect(WIFI_SCAN_INTERVAL_MS).toBe(35_000);
    expect(WIFI_SCAN_BUFFER_SIZE).toBe(3);
  });
});

describe('the fusion loop', () => {
  it('a high-confidence estimate overrides GPS', async () => {
    const fusion = await start({ scan: async () => fresh(), estimate: async () => estimateOf(0.8) });
    expect(fusion.resolve(GPS)).toEqual({ ...WIFI, positionSource: 'wifi' });
    fusion.stop();
  });

  it('a low-confidence estimate falls back to GPS', async () => {
    const fusion = await start({ scan: async () => fresh(), estimate: async () => estimateOf(0.4) });
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    fusion.stop();
  });

  it.each([
    ['empty', { outcome: 'empty', accepted: true, aps: [] }],
    ['throttled', { outcome: 'throttled', accepted: false }],
    ['stale', { outcome: 'stale', accepted: true }],
    ['timeout', { outcome: 'timeout', accepted: true }],
  ])('a %s scan falls back to GPS without estimating', async (_name, result) => {
    const estimate = vi.fn(async () => estimateOf(1));
    const fusion = await start({ scan: async () => result, estimate });
    expect(estimate).not.toHaveBeenCalled();
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    fusion.stop();
  });

  it('an empty scan replaces an earlier good estimate with GPS', async () => {
    const results = [fresh(), { outcome: 'empty', accepted: true, aps: [] }];
    const fusion = await start({ scan: async () => results.shift(), estimate: async () => estimateOf(0.9) });
    expect(fusion.resolve(GPS).positionSource).toBe('wifi');
    await vi.advanceTimersByTimeAsync(WIFI_SCAN_INTERVAL_MS);
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    fusion.stop();
  });

  it('a rejected scan (permission, WiFi off...) falls back to GPS', async () => {
    const scan = async () => {
      throw Object.assign(new Error('no'), { code: 'WIFI_OFF' });
    };
    const fusion = await start({ scan, estimate: async () => estimateOf(1) });
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    fusion.stop();
  });

  it('a rejected scan replaces an earlier good estimate with GPS', async () => {
    const scan = vi.fn().mockResolvedValueOnce(fresh()).mockRejectedValue(new Error('PERMISSION_DENIED'));
    const fusion = await start({ scan, estimate: async () => estimateOf(0.9) });
    expect(fusion.resolve(GPS).positionSource).toBe('wifi');
    await vi.advanceTimersByTimeAsync(WIFI_SCAN_INTERVAL_MS);
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    fusion.stop();
  });

  it('a table-load error falls back to GPS, and the loop keeps going', async () => {
    const estimate = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }))
      .mockResolvedValue(estimateOf(0.9));
    const fusion = await start({ scan: async () => fresh(), estimate });
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });

    await vi.advanceTimersByTimeAsync(WIFI_SCAN_INTERVAL_MS);
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(fusion.resolve(GPS)).toEqual({ ...WIFI, positionSource: 'wifi' });
    fusion.stop();
  });

  it('a table-load error replaces an earlier good estimate with GPS', async () => {
    const estimate = vi.fn().mockResolvedValueOnce(estimateOf(0.9)).mockRejectedValue(new Error('signed out'));
    const fusion = await start({ scan: async () => fresh(), estimate });
    expect(fusion.resolve(GPS).positionSource).toBe('wifi');
    await vi.advanceTimersByTimeAsync(WIFI_SCAN_INTERVAL_MS);
    expect(fusion.resolve(GPS).positionSource).toBe('gps');
    fusion.stop();
  });

  it('passes the last 3 fresh scans to the estimator, newest last', async () => {
    let n = 0;
    const scan = async () => fresh([{ ...AP, bssid: `aa:bb:cc:dd:ee:0${++n}` }]);
    const estimate = vi.fn(async () => estimateOf(0.9));
    const fusion = await start({ scan, estimate });
    await vi.advanceTimersByTimeAsync(4 * WIFI_SCAN_INTERVAL_MS);

    const bssids = (call) => call[0].map((aps) => aps[0].bssid.slice(-1));
    expect(estimate.mock.calls.map(bssids)).toEqual([['1'], ['1', '2'], ['1', '2', '3'], ['2', '3', '4'], ['3', '4', '5']]);
    fusion.stop();
  });

  it('drops buffered scans older than the max age, e.g. after the app was paused', async () => {
    const results = [fresh([{ ...AP, bssid: 'old' }]), fresh([{ ...AP, bssid: 'new' }])];
    const estimate = vi.fn(async () => estimateOf(0.9));
    const fusion = await start({ scan: async () => results.shift(), estimate, intervalMs: 10 * 60_000 });
    await vi.advanceTimersByTimeAsync(10 * 60_000); // like timers paused for 10 minutes
    expect(10 * 60_000).toBeGreaterThan(WIFI_SCAN_MAX_AGE_MS); // so 'old' is past the limit
    expect(estimate.mock.calls[1][0]).toEqual([[{ ...AP, bssid: 'new' }]]);
    fusion.stop();
  });

  it('ignores an estimate older than the max age, so a resumed GPS fix is not overridden', async () => {
    // An interval that never comes round stands in for timers paused in the background.
    const fusion = await start({ scan: async () => fresh(), estimate: async () => estimateOf(0.9), intervalMs: 1e9 });
    expect(fusion.resolve(GPS).positionSource).toBe('wifi');
    vi.setSystemTime(Date.now() + WIFI_ESTIMATE_MAX_AGE_MS); // still just inside
    expect(fusion.resolve(GPS).positionSource).toBe('wifi');
    vi.setSystemTime(Date.now() + 1);
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    fusion.stop();
  });

  it('never scans outside the Android app', async () => {
    const scan = vi.fn(async () => fresh());
    const fusion = startWifiFusion({ scan, isAvailable: () => false, estimate: async () => estimateOf(1) });
    await vi.advanceTimersByTimeAsync(10 * WIFI_SCAN_INTERVAL_MS);
    expect(scan).not.toHaveBeenCalled();
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
  });

  it('stops scanning, and falls back to GPS, once stopped', async () => {
    const scan = vi.fn(async () => fresh());
    const fusion = await start({ scan, estimate: async () => estimateOf(0.9) });
    expect(vi.getTimerCount()).toBe(1);
    fusion.stop();
    expect(vi.getTimerCount()).toBe(0); // the interval is cleared, not just ignored
    await vi.advanceTimersByTimeAsync(10 * WIFI_SCAN_INTERVAL_MS);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(fusion.resolve(GPS).positionSource).toBe('gps');
  });

  it('does not start a scan while the previous one is still running', async () => {
    const scan = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(fresh()), 45_000)));
    const fusion = await start({ scan, estimate: async () => estimateOf(0.9) });
    await vi.advanceTimersByTimeAsync(40_000); // the first interval tick lands mid-scan
    expect(scan).toHaveBeenCalledTimes(1);
    fusion.stop();
  });

  it('keeps positionSource defined whatever each cycle returns', async () => {
    const outcomes = [
      () => fresh(),
      () => ({ outcome: 'throttled', accepted: false }),
      () => {
        throw new Error('SCAN_IN_PROGRESS');
      },
      () => ({ outcome: 'empty', accepted: true, aps: [] }),
      () => undefined,
      () => fresh(),
    ];
    const confidences = [0.1, 0.9, 0.6, 0];
    let i = 0;
    const fusion = await start({
      scan: async () => outcomes[i++ % outcomes.length](),
      estimate: async () => estimateOf(confidences[i % confidences.length]),
    });
    for (let step = 0; step < 24; step++) {
      expect(['gps', 'wifi']).toContain(fusion.resolve(GPS).positionSource);
      await vi.advanceTimersByTimeAsync(WIFI_SCAN_INTERVAL_MS);
    }
    fusion.stop();
  });
});

describe('the scan budget', () => {
  /**
   * A phone that enforces Android's rule itself: 4 accepted scans per rolling 2 minutes,
   * and 'throttled' past that. Records every scan() call and every refusal.
   */
  function fakeOs() {
    const accepted = [];
    const calls = [];
    let refused = 0;
    const scan = async () => {
      const t = Date.now();
      calls.push(t);
      if (accepted.filter((a) => t - a < SCAN_WINDOW_MS).length >= SCAN_LIMIT) {
        refused++;
        return { outcome: 'throttled', accepted: false };
      }
      accepted.push(t);
      return fresh();
    };
    const maxInAnyWindow = () =>
      Math.max(0, ...calls.map((t) => calls.filter((c) => c >= t && c - t < SCAN_WINDOW_MS).length));
    return { scan, calls, maxInAnyWindow, refused: () => refused };
  }

  it('at the shipped interval, is never refused over an hour', async () => {
    const os = fakeOs();
    const fusion = await start({ scan: os.scan, estimate: async () => estimateOf(0.9) });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    fusion.stop();

    expect(os.refused()).toBe(0);
    expect(os.maxInAnyWindow()).toBeLessThanOrEqual(SCAN_LIMIT);
    // one at start, then one per interval (103 at 35 s)
    expect(os.calls.length).toBe(Math.floor((60 * 60_000) / WIFI_SCAN_INTERVAL_MS) + 1);
  });

  it('holds to the budget even when the interval is far too fast', async () => {
    const os = fakeOs();
    const onCycle = vi.fn();
    const fusion = await start({ scan: os.scan, estimate: async () => estimateOf(0.9), intervalMs: 1_000, onCycle });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    fusion.stop();

    expect(os.refused()).toBe(0);
    expect(os.maxInAnyWindow()).toBe(SCAN_LIMIT);
    expect(os.calls.length).toBe(4 * 5 + 1); // 4 per 2 minutes over 10 minutes, window edge inclusive
    expect(onCycle).toHaveBeenCalledWith('budget'); // the skipped cycles
  });

  it('a skipped cycle falls back to GPS like any other', async () => {
    const os = fakeOs();
    const fusion = await start({ scan: os.scan, estimate: async () => estimateOf(0.9), intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000); // 4 scans spent at 0-3 s
    expect(fusion.resolve(GPS).positionSource).toBe('wifi');
    await vi.advanceTimersByTimeAsync(1_000); // 5th cycle: budget exhausted
    expect(fusion.resolve(GPS)).toEqual({ ...GPS, positionSource: 'gps' });
    fusion.stop();
  });

  it('does not count scans the OS refused', async () => {
    let first = true;
    const scan = vi.fn(async () => {
      if (first) {
        first = false;
        return { outcome: 'throttled', accepted: false };
      }
      return fresh();
    });
    const fusion = await start({ scan, estimate: async () => estimateOf(0.9), intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(scan).toHaveBeenCalledTimes(5); // the refusal plus a full budget of 4
    fusion.stop();
  });
});

// ---------------------------------------------------------------- Stage 7: indoor reading

describe('indoorReading (what the map UI is allowed to show)', () => {
  const withFloors = (e, floors = [0, 1, 2, 7]) => ({ ...e, floors });

  it('accepts a trusted estimate for a known building and a whole floor', () => {
    expect(indoorReading(withFloors(estimateOf(0.8)))).toEqual({
      ...WIFI, building: 'TECH PARK', floor: 1, confidence: 0.8, floors: [0, 1, 2, 7],
    });
  });

  it('refuses anything Stage 6 would not broadcast as wifi', () => {
    expect(indoorReading(null)).toBeNull();
    expect(indoorReading(withFloors(estimateOf(0.59)))).toBeNull();
    expect(indoorReading(withFloors({ ...estimateOf(1), lat: null, lng: null }))).toBeNull();
  });

  it('refuses an unrecognised building or an outdoor/odd floor', () => {
    expect(indoorReading(withFloors({ ...estimateOf(1), building: 'OTHER' }))).toBeNull();
    expect(indoorReading(withFloors({ ...estimateOf(1), building: null, floor: null }))).toBeNull();
    expect(indoorReading(withFloors({ ...estimateOf(1), floor: null }))).toBeNull();
    expect(indoorReading(withFloors({ ...estimateOf(1), floor: 1.5 }))).toBeNull();
  });

  it('always includes the live floor among the tabs, sorted', () => {
    expect(indoorReading(withFloors(estimateOf(1), [7, 0])).floors).toEqual([0, 1, 7]);
    expect(indoorReading({ ...estimateOf(1) }).floors).toEqual([1]);
  });
});

describe('the controller, for the map UI', () => {
  const floorsFor = vi.fn(async () => [0, 1, 2, 7]);

  it('reports the indoor reading, with its floors and expiry, only while fresh', async () => {
    const fusion = await start({ scan: async () => fresh(), estimate: async () => estimateOf(0.8), floorsFor, intervalMs: 10 * WIFI_ESTIMATE_MAX_AGE_MS });
    expect(floorsFor).toHaveBeenCalledWith('TECH PARK');
    expect(fusion.indoor()).toEqual({
      ...WIFI, building: 'TECH PARK', floor: 1, confidence: 0.8, floors: [0, 1, 2, 7],
      expiresAt: Date.now() + WIFI_ESTIMATE_MAX_AGE_MS,
    });
    await vi.advanceTimersByTimeAsync(WIFI_ESTIMATE_MAX_AGE_MS + 1);
    expect(fusion.indoor()).toBeNull();
    expect(fusion.resolve(GPS).positionSource).toBe('gps'); // the two agree
    fusion.stop();
  });

  it('is null whenever resolve() would answer gps', async () => {
    const lookup = vi.fn(async () => [0, 1]);
    const fusion = await start({ scan: async () => fresh(), estimate: async () => estimateOf(0.4), floorsFor: lookup });
    expect(fusion.indoor()).toBeNull();
    expect(lookup).not.toHaveBeenCalled(); // not looked up for a reading never shown
    fusion.stop();
  });

  it('is null for a building outside the campus database, though WiFi is still broadcast', async () => {
    const fusion = await start({ scan: async () => fresh(), estimate: async () => ({ ...estimateOf(0.9), building: 'OTHER' }), floorsFor });
    expect(fusion.resolve(GPS).positionSource).toBe('wifi');
    expect(fusion.indoor()).toBeNull();
    fusion.stop();
  });

  it('keeps the estimate when the floor lookup fails, with just the live floor as a tab', async () => {
    const fusion = await start({
      scan: async () => fresh(), estimate: async () => estimateOf(0.9), floorsFor: async () => { throw new Error('offline'); },
    });
    expect(fusion.indoor().floors).toEqual([1]);
    fusion.stop();
  });

  it('tells subscribers after every cycle and on stop, and not after unsubscribing', async () => {
    const results = [fresh(), { outcome: 'empty', accepted: true, aps: [] }, fresh()];
    const fusion = startWifiFusion({ isAvailable: () => true, scan: async () => results.shift(), estimate: async () => estimateOf(0.9), floorsFor });
    const seen = [];
    const unsubscribe = fusion.subscribe(() => seen.push(fusion.indoor()?.floor ?? null));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(WIFI_SCAN_INTERVAL_MS);
    expect(seen).toEqual([1, null]); // signal lost -> null, no error state
    unsubscribe();
    await vi.advanceTimersByTimeAsync(WIFI_SCAN_INTERVAL_MS);
    expect(seen).toEqual([1, null]);

    const late = vi.fn();
    fusion.subscribe(late);
    fusion.stop();
    expect(late).toHaveBeenCalledTimes(1);
    expect(fusion.indoor()).toBeNull();
  });
});
