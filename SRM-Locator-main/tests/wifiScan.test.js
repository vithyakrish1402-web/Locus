import { describe, expect, it } from 'vitest';
import { SCAN_LIMIT, SCAN_WINDOW_MS, WifiScan, isWifiScanAvailable, scanBudget } from '../src/utils/wifiScan.js';

// Same cases as the survey tool's scanBudget tests (tools/wifi-survey/tests/scan.test.js),
// so the two copies of the budget can't drift apart unnoticed.
describe('scanBudget', () => {
  const now = 1_000_000;

  it('is the OS limit: 4 scans per 2 minutes', () => {
    expect(SCAN_LIMIT).toBe(4);
    expect(SCAN_WINDOW_MS).toBe(120_000);
  });

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

describe('WifiScan outside the Android app', () => {
  it('is reported unavailable', () => {
    expect(isWifiScanAvailable()).toBe(false);
  });

  it('rejects with UNAVAILABLE rather than pretending no WiFi is in range', async () => {
    await expect(WifiScan.scan()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
