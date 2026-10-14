import { describe, it, expect, vi } from 'vitest';
import {
  evaluateAlertPermission, DEFAULT_RULES_CONFIG, isClassHours, wallClock, locationStatus,
  distanceToZoneM, quietZoneAt,
} from '../backend/alertRules.js';
import { forceClassHoursStatus, guardStartupLine, QUIET_ZONES } from '../backend/alertConfig.js';

/**
 * The SOS / Ping decision (backend/alertRules.js), on its own: no sockets, no clock, no
 * environment. Every rule, every priority conflict, the Asia/Kolkata boundaries, and the
 * guarantee that an SOS is never locked out by rate limits or an unknown position.
 */

// Spelled out, never read from the environment, so nothing outside this file changes a result.
const config = {
  ...DEFAULT_RULES_CONFIG,
  quietZonesEnabled: true,
  sosQuietZoneMode: 'guarded',
  pingQuietZoneMode: 'blocked',
  quietZoneBufferM: 30,
  pointZoneRadiusM: 40,
  locationMaxAgeSec: 120,
  locationMaxAccuracyM: 60,
  pingCooldownSec: 20,
  pingMaxPerWindow: 8,
  pingWindowMin: 10,
  classHours: { days: [1, 2, 3, 4, 5, 6], start: '08:30', end: '16:30', breaks: [] },
  timeZone: 'Asia/Kolkata',
  forceClassHours: false,
};

// Wednesday 7 Jan 2026, in India. The server runs in UTC, so these are the instants a
// naive getHours() check would get wrong by five and a half hours.
const IST = (hhmm, day = '2026-01-07') => Date.parse(`${day}T${hhmm}:00+05:30`);
const DURING_CLASS = IST('11:00');
const AFTER_CLASS = IST('20:00');
const SUNDAY_NOON = IST('12:00', '2026-01-04');

// Positions around TECH PARK 2 (outline: lat 12.8245215..12.8248919, lng 80.045725..80.0460398;
// the nearest other quiet zone is far away). 0.0001 degrees of longitude is about 10.9 m here.
const INSIDE = { lat: 12.8247, lng: 80.04588 };
const NEAR_BUFFER = { lat: 12.8247, lng: 80.0460398 + 0.0002 }; // ~22 m outside the wall
const BEYOND_BUFFER = { lat: 12.8247, lng: 80.0460398 + 0.0003 }; // ~33 m outside the wall
const HOSTEL = { lat: 12.8222, lng: 80.0436 }; // PAARI HOSTEL's yard: not a teaching building

const at = (where, extra = {}) => ({ ...where, ageMs: 5000, ...extra });
const base = { settings: { sosEnabled: true, pingEnabled: true }, now: DURING_CLASS, location: at(HOSTEL) };
const sos = (over = {}) => evaluateAlertPermission({ ...base, type: 'sos', ...over }, config);
const ping = (over = {}) => evaluateAlertPermission({ ...base, type: 'ping', ...over }, config);

describe('class hours (Asia/Kolkata)', () => {
  const inClass = (ms) => isClassHours(ms, config);

  it('starts at 08:30 and ends at 16:30 India time, start inclusive and end exclusive', () => {
    expect(inClass(IST('08:29'))).toBe(false);
    expect(inClass(IST('08:30'))).toBe(true);
    expect(inClass(IST('16:29'))).toBe(true);
    expect(inClass(IST('16:30'))).toBe(false);
  });

  it('is judged in India, not in the zone the server happens to run in', () => {
    // 03:00 UTC is 08:30 in India; 11:00 UTC is 16:30.
    expect(inClass(Date.parse('2026-01-07T02:59:00Z'))).toBe(false);
    expect(inClass(Date.parse('2026-01-07T03:00:00Z'))).toBe(true);
    expect(inClass(Date.parse('2026-01-07T10:59:00Z'))).toBe(true);
    expect(inClass(Date.parse('2026-01-07T11:00:00Z'))).toBe(false);
    // 19:00 UTC on Tuesday is half past midnight on Wednesday in India: the day rolls over too.
    expect(wallClock(Date.parse('2026-01-06T19:00:00Z'), 'Asia/Kolkata')).toEqual({ day: 3, minutes: 30 });
  });

  it('runs Monday to Saturday', () => {
    expect(inClass(IST('11:00', '2026-01-05'))).toBe(true); // Monday
    expect(inClass(IST('11:00', '2026-01-10'))).toBe(true); // Saturday
    expect(inClass(SUNDAY_NOON)).toBe(false);
  });

  it('is out during a break and back after it', () => {
    const withBreak = { ...config, classHours: { ...config.classHours, breaks: [{ from: '12:30', to: '13:30' }] } };
    expect(isClassHours(IST('12:29'), withBreak)).toBe(true);
    expect(isClassHours(IST('12:30'), withBreak)).toBe(false);
    expect(isClassHours(IST('13:29'), withBreak)).toBe(false);
    expect(isClassHours(IST('13:30'), withBreak)).toBe(true);
  });

  it('is always on when forced', () => {
    expect(isClassHours(SUNDAY_NOON, { ...config, forceClassHours: true })).toBe(true);
    expect(isClassHours(IST('03:00'), { ...config, forceClassHours: true })).toBe(true);
  });
});

describe('forcing class hours', () => {
  it('needs LOCUS_FORCE_CLASS_HOURS=true', () => {
    expect(forceClassHoursStatus({})).toEqual({ forced: false, refused: false });
    expect(forceClassHoursStatus({ LOCUS_FORCE_CLASS_HOURS: 'yes' })).toEqual({ forced: false, refused: false });
    expect(forceClassHoursStatus({ LOCUS_FORCE_CLASS_HOURS: 'true' })).toEqual({ forced: true, refused: false });
  });

  it('is refused in production unless explicitly allowed there as well', () => {
    const production = { NODE_ENV: 'production', LOCUS_FORCE_CLASS_HOURS: 'true' };
    expect(forceClassHoursStatus(production)).toEqual({ forced: false, refused: true });
    expect(forceClassHoursStatus({ ...production, LOCUS_ALLOW_FORCE_IN_PRODUCTION: 'true' })).toEqual({ forced: true, refused: false });
  });
});

describe('distance to a quiet zone', () => {
  const tp2 = QUIET_ZONES.find((z) => z.name === 'TECH PARK 2');
  const valliammai = QUIET_ZONES.find((z) => z.name === 'VALLIAMMAI ENGINEERING COLLEGE');

  it('is zero inside an outline and grows past the wall', () => {
    expect(distanceToZoneM(INSIDE.lat, INSIDE.lng, tp2, 40)).toBe(0);
    expect(distanceToZoneM(NEAR_BUFFER.lat, NEAR_BUFFER.lng, tp2, 40)).toBeGreaterThan(20);
    expect(distanceToZoneM(NEAR_BUFFER.lat, NEAR_BUFFER.lng, tp2, 40)).toBeLessThan(25);
    expect(distanceToZoneM(BEYOND_BUFFER.lat, BEYOND_BUFFER.lng, tp2, 40)).toBeGreaterThan(30);
  });

  it('treats a building with no outline as a circle around its point', () => {
    expect(valliammai.footprint).toBeNull();
    const metresNorth = (m) => distanceToZoneM(valliammai.lat + m / 111320, valliammai.lng, valliammai, 40);
    expect(metresNorth(30)).toBe(0); // inside the 40 m circle
    expect(metresNorth(60)).toBeCloseTo(20, 0);
  });

  it('finds the zone a position is in or within the buffer of, and none beyond it', () => {
    const find = (p) => quietZoneAt(p.lat, p.lng, QUIET_ZONES, 30, 40)?.name ?? null;
    expect(find(INSIDE)).toBe('TECH PARK 2');
    expect(find(NEAR_BUFFER)).toBe('TECH PARK 2');
    expect(find(BEYOND_BUFFER)).toBeNull();
    expect(find(HOSTEL)).toBeNull();
  });

  it('knows the real teaching buildings, and none of the hostels', () => {
    const names = QUIET_ZONES.map((z) => z.name);
    expect(names).toEqual(expect.arrayContaining(['TECH PARK', 'TECH PARK 2', 'MBA BLOCK', 'C V RAMAN BLOCK']));
    expect(names.filter((n) => /HOSTEL|JAVA|HOTEL|AUDITORIUM/.test(n))).toEqual([]);
  });
});

describe('how far a position is trusted', () => {
  const status = (location) => locationStatus(location, config);

  it('needs a position, a recent one, and one that is not too vague', () => {
    expect(status(null)).toBe('missing');
    expect(status({ lat: NaN, lng: 80, ageMs: 0 })).toBe('missing');
    expect(status(at(HOSTEL))).toBe('ok');
    expect(status(at(HOSTEL, { ageMs: 120000 }))).toBe('ok');
    expect(status(at(HOSTEL, { ageMs: 120001 }))).toBe('stale');
    expect(status(at(HOSTEL, { accuracyM: 60 }))).toBe('ok');
    expect(status(at(HOSTEL, { accuracyM: 60.5 }))).toBe('inaccurate');
  });

  it('does not hold a missing accuracy against the sender', () => {
    expect(status(at(HOSTEL, { accuracyM: undefined }))).toBe('ok');
    expect(status(at(HOSTEL, { accuracyM: NaN }))).toBe('ok');
  });
});

describe('the Group Lead\'s switches', () => {
  it('turn SOS off for the Group', () => {
    expect(sos({ settings: { sosEnabled: false, pingEnabled: true } })).toMatchObject({ allowed: false, mode: 'blocked', reasonCode: 'GROUP_DISABLED' });
  });

  it('turn Ping off for the Group, and leave SOS alone', () => {
    const settings = { sosEnabled: true, pingEnabled: false };
    expect(ping({ settings })).toMatchObject({ allowed: false, reasonCode: 'GROUP_DISABLED' });
    expect(sos({ settings })).toMatchObject({ allowed: true, mode: 'allow' });
  });

  it('leave SOS working when only Ping is off, and Ping working when only SOS is off', () => {
    expect(ping({ settings: { sosEnabled: false, pingEnabled: true } })).toMatchObject({ allowed: true });
  });

  it('mute one member\'s pings but never their SOS', () => {
    expect(ping({ senderMuted: true })).toMatchObject({ allowed: false, reasonCode: 'MEMBER_MUTED' });
    expect(sos({ senderMuted: true })).toMatchObject({ allowed: true, mode: 'allow' });
  });
});

describe('quiet zones', () => {
  const inZone = { location: at(INSIDE) };

  it('block a Ping and flag an SOS, during class hours', () => {
    expect(ping(inZone)).toMatchObject({ allowed: false, mode: 'blocked', reasonCode: 'QUIET_ZONE', zone: 'TECH PARK 2' });
    expect(sos(inZone)).toMatchObject({ allowed: true, mode: 'guarded', reasonCode: 'QUIET_ZONE', zone: 'TECH PARK 2' });
  });

  it('follow the configured mode for each kind of alert', () => {
    const strict = { ...config, sosQuietZoneMode: 'blocked' };
    expect(evaluateAlertPermission({ ...base, type: 'sos', ...inZone }, strict)).toMatchObject({ allowed: false, mode: 'blocked', reasonCode: 'QUIET_ZONE' });
    const lenient = { ...config, pingQuietZoneMode: 'guarded' };
    expect(evaluateAlertPermission({ ...base, type: 'ping', ...inZone }, lenient)).toMatchObject({ allowed: true, mode: 'guarded', reasonCode: 'QUIET_ZONE' });
  });

  it('cover the buffer around the building, and not beyond it', () => {
    expect(ping({ location: at(NEAR_BUFFER) })).toMatchObject({ allowed: false, reasonCode: 'QUIET_ZONE' });
    expect(ping({ location: at(BEYOND_BUFFER) })).toMatchObject({ allowed: true, mode: 'allow' });
  });

  it('do not exist outside class hours, on Sundays, or for places that are not teaching buildings', () => {
    expect(ping({ ...inZone, now: AFTER_CLASS })).toMatchObject({ allowed: true, mode: 'allow' });
    expect(ping({ ...inZone, now: SUNDAY_NOON })).toMatchObject({ allowed: true, mode: 'allow' });
    expect(ping({ location: at(HOSTEL) })).toMatchObject({ allowed: true, mode: 'allow' });
  });

  it('judge class hours on classNow when it is given, but cooldowns on now', () => {
    expect(ping({ ...inZone, now: DURING_CLASS, classNow: SUNDAY_NOON })).toMatchObject({ allowed: true });
    expect(ping({ ...inZone, now: SUNDAY_NOON, classNow: DURING_CLASS })).toMatchObject({ allowed: false, reasonCode: 'QUIET_ZONE' });
  });

  it('apply everywhere at any hour when class hours are forced', () => {
    const forced = { ...config, forceClassHours: true };
    expect(evaluateAlertPermission({ ...base, type: 'ping', location: at(INSIDE), now: AFTER_CLASS }, forced)).toMatchObject({ allowed: false, reasonCode: 'QUIET_ZONE' });
  });
});

describe('ping limits', () => {
  const now = DURING_CLASS;

  it('allow a second ping to the same person once the cooldown has passed, not before', () => {
    expect(ping({ history: { lastToTargetAt: now - 19000 } })).toMatchObject({ allowed: false, reasonCode: 'COOLDOWN', retryAfterSec: 1 });
    expect(ping({ history: { lastToTargetAt: now - 5000 } })).toMatchObject({ allowed: false, reasonCode: 'COOLDOWN', retryAfterSec: 15 });
    expect(ping({ history: { lastToTargetAt: now - 20000 } })).toMatchObject({ allowed: true });
  });

  it('do not hold a ping to someone else against the cooldown', () => {
    // lastToTargetAt is for THIS target; an earlier ping to another person is only in recentAts.
    expect(ping({ history: { lastToTargetAt: null, recentAts: [now - 1000] } })).toMatchObject({ allowed: true });
  });

  it('cap how many a sender can send in the window, and say when they can try again', () => {
    const eight = Array.from({ length: 8 }, (_, i) => now - 60000 - i * 30000); // 1:00 ... 4:30 ago
    expect(ping({ history: { recentAts: eight } })).toMatchObject({ allowed: false, reasonCode: 'COOLDOWN' });
    // The oldest is 4:30 old, in a 10-minute window: free again in 5:30 = 330 s.
    expect(ping({ history: { recentAts: eight } }).retryAfterSec).toBe(330);
    expect(ping({ history: { recentAts: eight.slice(1) } })).toMatchObject({ allowed: true });
  });

  it('count only the pings still inside the window', () => {
    const old = Array.from({ length: 8 }, () => now - 11 * 60 * 1000);
    expect(ping({ history: { recentAts: old } })).toMatchObject({ allowed: true });
  });

  it('wait only for as many to expire as it takes to get under the cap', () => {
    // Ten in the window: two must age out before another is allowed, so the wait is for the
    // third-oldest... i.e. index (10 - 8) = 2 in oldest-first order.
    const ten = Array.from({ length: 10 }, (_, i) => now - (9 - i) * 60000); // 9:00 ago ... 0:00 ago
    expect(ping({ history: { recentAts: ten } }).retryAfterSec).toBe(600 - 7 * 60);
  });

  it('never apply to SOS, however often it is pressed', () => {
    const history = { lastToTargetAt: now - 1000, recentAts: Array.from({ length: 50 }, () => now - 1000) };
    expect(sos({ history })).toMatchObject({ allowed: true, mode: 'allow' });
  });
});

describe('a position the server cannot rely on', () => {
  const unknowns = {
    missing: null,
    stale: at(HOSTEL, { ageMs: 300000 }),
    inaccurate: at(HOSTEL, { accuracyM: 200 }),
  };

  for (const [why, location] of Object.entries(unknowns)) {
    it(`blocks a Ping and lets an SOS through, flagged, during class hours (${why})`, () => {
      expect(ping({ location })).toMatchObject({ allowed: false, mode: 'blocked', reasonCode: 'LOCATION_UNKNOWN' });
      expect(sos({ location })).toMatchObject({ allowed: true, mode: 'guarded', reasonCode: 'LOCATION_UNKNOWN' });
    });

    it(`does not matter outside class hours (${why})`, () => {
      expect(ping({ location, now: AFTER_CLASS })).toMatchObject({ allowed: true, mode: 'allow' });
      expect(sos({ location, now: AFTER_CLASS })).toMatchObject({ allowed: true, mode: 'allow' });
    });
  }

  it('is never read as "outside the quiet zone": an old position beside a classroom still blocks the Ping', () => {
    const lastSeenBeside = at(INSIDE, { ageMs: 600000 });
    expect(ping({ location: lastSeenBeside })).toMatchObject({ allowed: false, reasonCode: 'LOCATION_UNKNOWN' });
  });
});

describe('priorities', () => {
  const everythingWrong = {
    settings: { sosEnabled: false, pingEnabled: false },
    senderMuted: true,
    location: at(INSIDE),
    history: { lastToTargetAt: DURING_CLASS - 1000, recentAts: Array(8).fill(DURING_CLASS - 1000) },
  };

  it('the Group switch beats the quiet zone, the cooldown and everything else', () => {
    expect(ping(everythingWrong)).toMatchObject({ reasonCode: 'GROUP_DISABLED' });
    expect(sos(everythingWrong)).toMatchObject({ reasonCode: 'GROUP_DISABLED' });
  });

  it('a member mute beats the quiet zone and the cooldown', () => {
    expect(ping({ ...everythingWrong, settings: { sosEnabled: true, pingEnabled: true } })).toMatchObject({ reasonCode: 'MEMBER_MUTED' });
  });

  it('the quiet zone beats the cooldown', () => {
    expect(ping({ ...everythingWrong, settings: { sosEnabled: true, pingEnabled: true }, senderMuted: false })).toMatchObject({ reasonCode: 'QUIET_ZONE' });
  });

  it('the cooldown beats an unknown position', () => {
    expect(ping({ location: null, history: { lastToTargetAt: DURING_CLASS - 1000 } })).toMatchObject({ reasonCode: 'COOLDOWN' });
  });

  it('an SOS in a quiet zone with an unknown position is judged on the zone first only when the position is known', () => {
    expect(sos({ location: at(INSIDE, { ageMs: 600000 }) })).toMatchObject({ mode: 'guarded', reasonCode: 'LOCATION_UNKNOWN' });
    expect(sos({ location: at(INSIDE) })).toMatchObject({ mode: 'guarded', reasonCode: 'QUIET_ZONE' });
  });
});

describe('the default configuration', () => {
  it('loads the quiet zones from the campus database', () => {
    expect(DEFAULT_RULES_CONFIG.zones.length).toBe(QUIET_ZONES.length);
    expect(QUIET_ZONES.length).toBeGreaterThanOrEqual(10);
    expect(QUIET_ZONES.every((z) => Number.isFinite(z.lat) && Number.isFinite(z.lng))).toBe(true);
  });
});

describe('the quiet-zone master switch', () => {
  const off = { ...config, quietZonesEnabled: false };
  const judge = (type, over, cfg) => evaluateAlertPermission({ ...base, type, ...over }, cfg);
  const stale = at(HOSTEL, { ageMs: 600000 });
  const everyHour = [DURING_CLASS, AFTER_CLASS, SUNDAY_NOON];

  for (const type of ['sos', 'ping']) {
    describe(type, () => {
      it('in a quiet zone, during class hours: restricted with the switch on, untouched with it off', () => {
        const on = judge(type, { location: at(INSIDE) }, config);
        expect(on.reasonCode).toBe('QUIET_ZONE');
        expect(judge(type, { location: at(INSIDE) }, off)).toEqual({ allowed: true, mode: 'allow', reasonCode: null });
      });

      it('with no position or an old one, during class hours: handled with the switch on, untouched with it off', () => {
        for (const location of [null, stale]) {
          expect(judge(type, { location }, config).reasonCode).toBe('LOCATION_UNKNOWN');
          expect(judge(type, { location }, off)).toEqual({ allowed: true, mode: 'allow', reasonCode: null });
        }
      });

      it('behaves with the switch off exactly as it does outside class hours', () => {
        for (const location of [null, stale, at(INSIDE), at(NEAR_BUFFER), at(HOSTEL)]) {
          const outsideClass = judge(type, { location, now: AFTER_CLASS }, config);
          for (const now of everyHour) expect(judge(type, { location, now }, off)).toEqual(outsideClass);
        }
      });

      it('is not brought back by forcing class hours', () => {
        const forcedButOff = { ...off, forceClassHours: true };
        expect(judge(type, { location: at(INSIDE), now: SUNDAY_NOON }, forcedButOff)).toMatchObject({ allowed: true, mode: 'allow' });
      });
    });
  }

  describe('the rules it must not weaken', () => {
    const switches = { sosEnabled: false, pingEnabled: false };

    it("the Group Lead's switches still block SOS and Ping", () => {
      expect(judge('sos', { settings: switches }, off)).toMatchObject({ allowed: false, reasonCode: 'GROUP_DISABLED' });
      expect(judge('ping', { settings: switches }, off)).toMatchObject({ allowed: false, reasonCode: 'GROUP_DISABLED' });
    });

    it("a member mute still blocks that member's pings, not their SOS", () => {
      expect(judge('ping', { senderMuted: true }, off)).toMatchObject({ allowed: false, reasonCode: 'MEMBER_MUTED' });
      expect(judge('sos', { senderMuted: true }, off)).toMatchObject({ allowed: true });
    });

    it('the Ping cooldown and cap still apply, with the same wait', () => {
      const now = DURING_CLASS;
      expect(judge('ping', { history: { lastToTargetAt: now - 5000 } }, off)).toMatchObject({ allowed: false, reasonCode: 'COOLDOWN', retryAfterSec: 15 });
      const eight = Array.from({ length: 8 }, (_, i) => now - 60000 - i * 30000);
      expect(judge('ping', { history: { recentAts: eight } }, off)).toMatchObject({ allowed: false, reasonCode: 'COOLDOWN', retryAfterSec: 330 });
    });

    it('SOS is still never rate limited', () => {
      const history = { lastToTargetAt: DURING_CLASS - 1000, recentAts: Array(50).fill(DURING_CLASS - 1000) };
      expect(judge('sos', { history }, off)).toMatchObject({ allowed: true, mode: 'allow' });
    });

    it('the Group switch still beats the cooldown', () => {
      expect(judge('ping', { settings: switches, history: { lastToTargetAt: DURING_CLASS - 1000 } }, off)).toMatchObject({ reasonCode: 'GROUP_DISABLED' });
    });
  });
});

describe('what ships when nothing is configured', () => {
  // The module reads its environment when it loads, so load a fresh copy of it with every
  // LOCUS_ variable removed (and put them back afterwards).
  const freshConfig = async (set = {}) => {
    const saved = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('LOCUS_')));
    Object.keys(saved).forEach((k) => delete process.env[k]);
    Object.assign(process.env, set);
    try {
      vi.resetModules();
      return await import('../backend/alertConfig.js');
    } finally {
      Object.keys(process.env).filter((k) => k.startsWith('LOCUS_')).forEach((k) => delete process.env[k]);
      Object.assign(process.env, saved);
      vi.resetModules();
    }
  };

  it('has quiet zones OFF, and the always-on rules ON with their documented numbers', async () => {
    const c = await freshConfig();
    expect(c.QUIET_ZONES_ENABLED).toBe(false);
    expect(c.FORCE_CLASS_HOURS).toBe(false);
    expect(c.SOS_COALESCE_SEC).toBe(60); // coalescing is ON by default
    expect(c.PING_COOLDOWN_SEC).toBe(20);
    expect(c.PING_MAX_PER_WINDOW).toBe(8);
    expect(c.PING_WINDOW_MIN).toBe(10);
    expect(c.SOS_REPEAT_FLAG_COUNT).toBe(3);
    expect(c.SOS_REPEAT_WINDOW_MIN).toBe(15);
    expect(c.ALERT_LOG_SIZE).toBe(50);
    expect(c.SOS_IN_QUIET_ZONE_MODE).toBe('guarded');
    expect(c.PING_IN_QUIET_ZONE_MODE).toBe('blocked');
  });

  it('turns quiet zones on only for exactly "true"', async () => {
    expect((await freshConfig({ LOCUS_QUIET_ZONES_ENABLED: 'true' })).QUIET_ZONES_ENABLED).toBe(true);
    for (const value of ['', 'TRUE', '1', 'yes', 'false', ' true']) {
      expect((await freshConfig({ LOCUS_QUIET_ZONES_ENABLED: value })).QUIET_ZONES_ENABLED).toBe(false);
    }
  });

  it('ignores a nonsense number rather than switching a rule off', async () => {
    const c = await freshConfig({ LOCUS_SOS_COALESCE_SEC: 'soon', LOCUS_PING_COOLDOWN_SEC: '' });
    expect(c.SOS_COALESCE_SEC).toBe(60);
    expect(c.PING_COOLDOWN_SEC).toBe(20);
  });
});

describe('the startup line', () => {
  it('says what is always on and whether the switch and the override are on', () => {
    const line = (quietZonesEnabled, forceClassHours) => guardStartupLine({ quietZonesEnabled, forceClassHours });
    expect(line(false, false)).toContain('Always on: Group switches and mutes, Ping cooldown and cap, SOS coalescing, repeated-SOS notice, alert log');
    expect(line(false, false)).toContain('quiet zones + class-hours position rule OFF');
    expect(line(false, false)).toContain('FORCE_CLASS_HOURS off');
    expect(line(true, false)).toContain('quiet zones + class-hours position rule ON');
    expect(line(true, true)).toContain('FORCE_CLASS_HOURS ON');
    expect(line(true, true)).not.toContain('no effect');
    expect(line(false, true)).toContain('FORCE_CLASS_HOURS ON but has no effect while quiet zones are off');
    expect(line(false, false)).not.toContain('\n');
  });
});
