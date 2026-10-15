import { describe, it, expect } from 'vitest';
import { chooseSource, LIVE, PRESENCE } from '../backend/displaySource.js';

const base = { staleMs: 15_000, dwellMs: 30_000 };
const choose = (o) => chooseSource({ ...base, ...o });

describe('chooseSource', () => {
  it('shows the live socket when there is no presence entry, however old it is', () => {
    expect(choose({ liveLastSeen: 0, presenceLastSeen: null, now: 10 * 60_000 }).source).toBe(LIVE);
  });

  it('shows the live socket when it has nothing to show', () => {
    expect(choose({ liveLastSeen: null, presenceLastSeen: 5_000, now: 6_000 }).source).toBe(LIVE);
  });

  it('keeps the live socket while it is recent, even when presence is newer', () => {
    expect(choose({ liveLastSeen: 10_000, presenceLastSeen: 20_000, now: 24_000 }).source).toBe(LIVE);
  });

  it('prefers presence once the socket is older than the threshold and presence is newer', () => {
    expect(choose({ liveLastSeen: 10_000, presenceLastSeen: 20_000, now: 26_000 }).source).toBe(PRESENCE);
  });

  it('the threshold itself is not yet stale', () => {
    expect(choose({ liveLastSeen: 10_000, presenceLastSeen: 20_000, now: 25_000 }).source).toBe(LIVE);
  });

  it('keeps the live socket when it is old but presence is not newer', () => {
    expect(choose({ liveLastSeen: 20_000, presenceLastSeen: 10_000, now: 60_000 }).source).toBe(LIVE);
    expect(choose({ liveLastSeen: 20_000, presenceLastSeen: 20_000, now: 60_000 }).source).toBe(LIVE);
  });

  it('records when it switched, and keeps that while nothing changes', () => {
    const first = choose({ liveLastSeen: 10_000, presenceLastSeen: 20_000, now: 30_000 });
    expect(first).toEqual({ source: PRESENCE, since: 30_000 });
    const again = choose({ liveLastSeen: 10_000, presenceLastSeen: 25_000, now: 40_000, previous: first });
    expect(again).toBe(first);
  });

  it('does not go back to the socket before the dwell is over, even if the socket updated', () => {
    const prev = { source: PRESENCE, since: 30_000 };
    expect(choose({ liveLastSeen: 31_000, presenceLastSeen: 20_000, now: 32_000, previous: prev }).source).toBe(PRESENCE);
    expect(choose({ liveLastSeen: 59_000, presenceLastSeen: 20_000, now: 59_999, previous: prev }).source).toBe(PRESENCE);
  });

  it('goes back to the socket after the dwell only when the socket is newer than presence', () => {
    const prev = { source: PRESENCE, since: 30_000 };
    expect(choose({ liveLastSeen: 25_000, presenceLastSeen: 50_000, now: 70_000, previous: prev }).source).toBe(PRESENCE);
    expect(choose({ liveLastSeen: 65_000, presenceLastSeen: 50_000, now: 70_000, previous: prev })).toEqual({ source: LIVE, since: 70_000 });
  });

  it('the dwell is over exactly at its length', () => {
    const prev = { source: PRESENCE, since: 30_000 };
    expect(choose({ liveLastSeen: 59_000, presenceLastSeen: 20_000, now: 60_000, previous: prev }).source).toBe(LIVE);
  });

  it('a socket update at the same instant as the service report does not win it back', () => {
    const prev = { source: PRESENCE, since: 30_000 };
    expect(choose({ liveLastSeen: 50_000, presenceLastSeen: 50_000, now: 70_000, previous: prev }).source).toBe(PRESENCE);
  });

  it('forgets a choice once presence is gone', () => {
    const prev = { source: PRESENCE, since: 30_000 };
    expect(choose({ liveLastSeen: 25_000, presenceLastSeen: null, now: 40_000, previous: prev })).toEqual({ source: LIVE, since: 40_000 });
  });

  it('leapfrogging feeds switch far less with the dwell than without it', () => {
    const switchesWith = (dwellMs) => {
      let previous = null;
      let switches = 0;
      let last = LIVE;
      let live = 0;
      let presence = 0;
      for (let t = 0; t <= 120_000; t += 1_000) {
        if (t % 20_000 === 0) live = t; // a socket update every 20 s
        if (t % 20_000 === 10_000) presence = t; // a service report in between
        previous = chooseSource({ liveLastSeen: live, presenceLastSeen: presence, now: t, previous, staleMs: 5_000, dwellMs });
        if (previous.source !== last) { switches += 1; last = previous.source; }
      }
      return switches;
    };
    const held = switchesWith(30_000);
    expect(held).toBeLessThanOrEqual(2 * (120 / 30)); // each stay on presence lasts at least one dwell
    expect(switchesWith(0)).toBeGreaterThan(held);
  });
});
