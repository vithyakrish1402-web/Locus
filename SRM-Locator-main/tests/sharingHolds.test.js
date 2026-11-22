import { describe, it, expect } from 'vitest';
import {
  createHoldStore, holdMinuteMs, timedPrivacyEnabled,
  MAX_HOLD_MINUTES, HOLD_ALLOWANCE_MINUTES, HOLD_WINDOW_MINUTES,
} from '../backend/sharingHolds.js';

// Real minutes, on a clock the test moves.
const MIN = 60_000;
const store = () => createHoldStore({ minuteMs: MIN });

describe('the limits', () => {
  it('are 30 minutes a hold and 30 minutes of any rolling hour', () => {
    expect(MAX_HOLD_MINUTES).toBe(30);
    expect(HOLD_ALLOWANCE_MINUTES).toBe(30);
    expect(HOLD_WINDOW_MINUTES).toBe(60);
  });
});

describe('a hold', () => {
  it('runs for the minutes asked and then is no longer active', () => {
    const holds = store();
    const r = holds.start('u', { mode: 'GHOST', minutes: 10 }, 0);
    expect(r.ok).toBe(true);
    expect(r.hold.until).toBe(10 * MIN);
    expect(holds.active('u', 10 * MIN - 1)?.mode).toBe('GHOST');
    expect(holds.active('u', 10 * MIN)).toBeNull();
  });

  it('is ended by expire once its time is up, and only then', () => {
    const holds = store();
    holds.start('u', { mode: 'FROZEN', minutes: 5, spot: { lat: 1, lng: 2 } }, 0);
    expect(holds.expire(5 * MIN - 1)).toEqual([]);
    const ended = holds.expire(5 * MIN);
    expect(ended.map((e) => e.uid)).toEqual(['u']);
    expect(holds.size()).toBe(0);
  });

  it('keeps a Pause spot, and none for Hidden', () => {
    const holds = store();
    expect(holds.start('a', { mode: 'FROZEN', minutes: 1, spot: { lat: 1, lng: 2 } }, 0).hold.spot).toEqual({ lat: 1, lng: 2 });
    expect(holds.start('b', { mode: 'GHOST', minutes: 1, spot: { lat: 1, lng: 2 } }, 0).hold.spot).toBeNull();
  });

  it.each([
    ['ACTIVE', 5, 'bad-mode'],
    ['NOPE', 5, 'bad-mode'],
    [undefined, 5, 'bad-mode'],
    ['GHOST', 0, 'bad-minutes'],
    ['GHOST', -1, 'bad-minutes'],
    ['GHOST', 31, 'bad-minutes'],
    ['GHOST', Number.NaN, 'bad-minutes'],
    ['GHOST', '10', 'bad-minutes'],
    ['GHOST', Infinity, 'bad-minutes'],
  ])('refuses mode %s for %s minutes (%s)', (mode, minutes, reason) => {
    const holds = store();
    const r = holds.start('u', { mode, minutes }, 0);
    expect(r).toMatchObject({ ok: false, reason });
    expect(holds.active('u', 0)).toBeNull();
  });

  it('may be the full 30 minutes', () => {
    expect(store().start('u', { mode: 'GHOST', minutes: 30 }, 0).ok).toBe(true);
  });
});

describe('the rolling-hour allowance', () => {
  it('counts a running hold as spoken for', () => {
    const holds = store();
    holds.start('u', { mode: 'FROZEN', minutes: 20 }, 0);
    expect(holds.leftMs('u', 0)).toBe(10 * MIN);
    expect(holds.leftMs('u', 5 * MIN)).toBe(10 * MIN);
  });

  it('is not reset by pausing and resuming for a second', () => {
    const holds = store();
    let now = 0;
    // 30 tries of one second each: 30 seconds used, never a fresh 30 minutes.
    for (let i = 0; i < 30; i += 1) {
      expect(holds.start('u', { mode: 'FROZEN', minutes: 30 }, now).ok).toBe(i === 0);
      if (i === 0) {
        now += 1000;
        holds.end('u', now);
      }
    }
    expect(holds.leftMs('u', now)).toBe(30 * MIN - 1000);
    expect(holds.start('u', { mode: 'GHOST', minutes: 30 }, now)).toMatchObject({ ok: false, reason: 'allowance', leftMs: 30 * MIN - 1000 });
  });

  it('charges each short pause, so many of them add up', () => {
    const holds = store();
    let now = 0;
    for (let i = 0; i < 10; i += 1) {
      expect(holds.start('u', { mode: 'FROZEN', minutes: 1 }, now).ok).toBe(true);
      now += 30_000;
      holds.end('u', now);
      now += 1000;
    }
    expect(holds.leftMs('u', now)).toBe(30 * MIN - 10 * 30_000);
  });

  it('counts Pause and Hidden together', () => {
    const holds = store();
    holds.start('u', { mode: 'FROZEN', minutes: 15 }, 0);
    holds.expire(15 * MIN);
    holds.start('u', { mode: 'GHOST', minutes: 15 }, 15 * MIN);
    holds.expire(30 * MIN);
    expect(holds.leftMs('u', 30 * MIN)).toBe(0);
    expect(holds.start('u', { mode: 'FROZEN', minutes: 1 }, 30 * MIN)).toMatchObject({ ok: false, reason: 'allowance' });
  });

  it('comes back as old holds leave the hour', () => {
    const holds = store();
    holds.start('u', { mode: 'GHOST', minutes: 30 }, 0);
    holds.expire(30 * MIN);
    expect(holds.leftMs('u', 30 * MIN)).toBe(0);
    expect(holds.leftMs('u', 70 * MIN)).toBe(10 * MIN); // minutes 0..10 have left the window
    expect(holds.leftMs('u', 90 * MIN)).toBe(30 * MIN);
    expect(holds.start('u', { mode: 'GHOST', minutes: 30 }, 90 * MIN).ok).toBe(true);
  });

  it('lets a running hold be switched or asked again, paid from what is left', () => {
    const holds = store();
    holds.start('u', { mode: 'FROZEN', minutes: 20 }, 0);
    // 5 minutes in: 25 minutes are left (the 15 unused are given back), so 25 is fine and 26 is not.
    expect(holds.start('u', { mode: 'GHOST', minutes: 26 }, 5 * MIN)).toMatchObject({ ok: false, reason: 'allowance', leftMs: 25 * MIN });
    expect(holds.active('u', 5 * MIN)?.mode).toBe('FROZEN'); // a refusal leaves the hold as it was
    const r = holds.start('u', { mode: 'GHOST', minutes: 25 }, 5 * MIN);
    expect(r.ok).toBe(true);
    expect(r.ended.mode).toBe('FROZEN');
    expect(holds.leftMs('u', 5 * MIN)).toBe(0);
  });

  it('is kept per person', () => {
    const holds = store();
    holds.start('a', { mode: 'GHOST', minutes: 30 }, 0);
    expect(holds.leftMs('b', 0)).toBe(30 * MIN);
    expect(holds.start('b', { mode: 'GHOST', minutes: 30 }, 0).ok).toBe(true);
  });

  it('is not charged for time after a hold ended early', () => {
    const holds = store();
    holds.start('u', { mode: 'GHOST', minutes: 30 }, 0);
    holds.end('u', 2 * MIN);
    expect(holds.leftMs('u', 10 * MIN)).toBe(28 * MIN);
  });
});

describe('settings', () => {
  it('timed holds are off unless switched on with "true"', () => {
    expect(timedPrivacyEnabled({})).toBe(false);
    expect(timedPrivacyEnabled({ LOCUS_TIMED_PRIVACY_ENABLED: '1' })).toBe(false);
    expect(timedPrivacyEnabled({ LOCUS_TIMED_PRIVACY_ENABLED: 'true' })).toBe(true);
  });

  it('a short test minute is ignored in production', () => {
    expect(holdMinuteMs({})).toBe(60_000);
    expect(holdMinuteMs({ LOCUS_HOLD_MINUTE_MS: '100' })).toBe(100);
    expect(holdMinuteMs({ LOCUS_HOLD_MINUTE_MS: '100', NODE_ENV: 'production' })).toBe(60_000);
    expect(holdMinuteMs({ LOCUS_HOLD_MINUTE_MS: 'x' })).toBe(60_000);
  });
});
