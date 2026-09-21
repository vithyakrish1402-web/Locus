import { describe, expect, it } from 'vitest';
import { describeScan } from '../src/outcome.js';
import { blockersFromStatus } from '../src/readiness.js';
import { SCAN_WINDOW_MS, scanBudget } from '../src/scanBudget.js';

describe('scanBudget', () => {
  const now = 1_000_000;

  it('counts only scans inside the rolling 2-minute window', () => {
    const b = scanBudget([now - SCAN_WINDOW_MS - 1, now - 60_000, now - 1_000], now);
    expect(b).toEqual({ used: 2, limit: 4, retryInMs: 0 });
  });

  it('once 4 are used, says when the oldest of them falls out of the window', () => {
    const b = scanBudget([now - 100_000, now - 30_000, now - 20_000, now - 10_000], now);
    expect(b.used).toBe(4);
    expect(b.retryInMs).toBe(20_000);
  });

  it('uses the 4th-most-recent scan when more than 4 are in the window', () => {
    const b = scanBudget([now - 110_000, now - 90_000, now - 30_000, now - 20_000, now - 10_000], now);
    expect(b.retryInMs).toBe(30_000);
  });
});

describe('describeScan', () => {
  const aps = [{ bssid: 'a', ssid: 's', rssi: -50, frequencyMhz: 2412 }];

  it('only a fresh scan is loggable', () => {
    expect(describeScan({ outcome: 'fresh', aps, staleDropped: 0 }).loggable).toBe(true);
    for (const outcome of ['stale', 'throttled', 'timeout', 'empty', 'something-new']) {
      expect(describeScan({ outcome }).loggable).toBe(false);
    }
  });

  it('flags throttled and failed scans as stale, with the cache age and a retry time', () => {
    const throttled = describeScan({ outcome: 'throttled', newestResultAgeMs: 41_000 }, 25_000);
    expect(throttled.kind).toBe('stale');
    expect(throttled.title).toMatch(/Stale scan/);
    expect(throttled.detail).toMatch(/41 s before you tapped/);
    expect(throttled.detail).toMatch(/Retry in about 25 s/);

    const failed = describeScan({ outcome: 'stale', newestResultAgeMs: 64_000 });
    expect(failed.kind).toBe('stale');
    expect(failed.detail).toMatch(/Wait about 30 s/);
  });

  it('reports cached leftovers dropped from a fresh scan', () => {
    expect(describeScan({ outcome: 'fresh', aps, staleDropped: 2 }).detail).toMatch(/2 older cached entries were left out/);
  });
});

describe('blockersFromStatus', () => {
  const ok = { locationPermission: 'granted', locationServicesOn: true, wifiOn: true, scanAlwaysAvailable: false };
  const codes = (status) => blockersFromStatus({ ...ok, ...status }).map((b) => b.code);

  it('is empty when everything is in place', () => {
    expect(codes({})).toEqual([]);
  });

  it('keeps permission denied and Location switched off as separate, distinct states', () => {
    expect(codes({ locationPermission: 'denied' })).toEqual(['PERMISSION_DENIED']);
    expect(codes({ locationServicesOn: false })).toEqual(['LOCATION_OFF']);
    expect(codes({ locationPermission: 'denied', locationServicesOn: false })).toEqual(['PERMISSION_DENIED', 'LOCATION_OFF']);

    const [denied] = blockersFromStatus({ ...ok, locationPermission: 'denied' });
    const [off] = blockersFromStatus({ ...ok, locationServicesOn: false });
    expect(denied.title).not.toBe(off.title);
    expect(denied.actions).toEqual(['appSettings']);
    expect(off.actions).toEqual(['locationSettings']);
  });

  it('treats approximate-only location as its own blocker', () => {
    expect(codes({ locationPermission: 'approximate' })).toEqual(['PRECISE_LOCATION_OFF']);
  });

  it('WiFi off only blocks when background Wi-Fi scanning is also off', () => {
    expect(codes({ wifiOn: false, scanAlwaysAvailable: true })).toEqual([]);
    expect(codes({ wifiOn: false, scanAlwaysAvailable: false })).toEqual(['WIFI_OFF']);
  });
});
