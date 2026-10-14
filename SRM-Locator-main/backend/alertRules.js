// The one decision every SOS and Ping goes through before the server relays it.
//
// evaluateAlertPermission() is pure: it is handed everything it needs (the Group's switches,
// the sender's last position, their recent pings, the time) and returns a verdict. The
// server (server.js) gathers that input, asks, records the outcome, and only then relays.
// Nothing in this file touches a socket, the clock or the environment on its own.
//
// Verdict: { allowed, mode, reasonCode, retryAfterSec?, zone? }
//   mode 'allow'   - go ahead, nothing to say
//   mode 'guarded' - go ahead, but flagged (an SOS sent from a class zone, or without a
//                    position the server can trust); reasonCode says why
//   mode 'blocked' - do not relay; reasonCode tells the sender why
// reasonCode: GROUP_DISABLED | MEMBER_MUTED | QUIET_ZONE | COOLDOWN | LOCATION_UNKNOWN | null
//
// Rules, in priority order (the first that applies decides):
//   1. The Group Lead's switch for this kind of alert is off      -> blocked GROUP_DISABLED
//      (Ping only) the Group Lead muted this sender's pings        -> blocked MEMBER_MUTED
//   2. During class hours the sender is in or near a teaching building
//                                                                  -> QUIET_ZONE, per mode setting
//   3. (Ping only) too soon after the last ping to this person, or too many lately
//                                                                  -> blocked COOLDOWN
//   4. During class hours the sender's position is missing, old or too inaccurate
//      to say where they are                                       -> SOS guarded / Ping blocked,
//                                                                     LOCATION_UNKNOWN
// An SOS is never blocked by 3 or 4: safety first for SOS, silence first for Ping.
// Outside class hours there are no quiet zones, so 2 and 4 do not apply at all. Nor do they
// while the master switch is off (config.quietZonesEnabled, LOCUS_QUIET_ZONES_ENABLED):
// then only 1 and 3 are in force.

import {
  QUIET_ZONES_ENABLED, SOS_IN_QUIET_ZONE_MODE, PING_IN_QUIET_ZONE_MODE, QUIET_ZONE_BUFFER_M, POINT_ZONE_RADIUS_M,
  LOCATION_MAX_AGE_SEC, LOCATION_MAX_ACCURACY_M,
  PING_COOLDOWN_SEC, PING_MAX_PER_WINDOW, PING_WINDOW_MIN,
  CLASS_HOURS, CLASS_TIME_ZONE, FORCE_CLASS_HOURS, QUIET_ZONES,
} from './alertConfig.js';

export const DEFAULT_RULES_CONFIG = {
  quietZonesEnabled: QUIET_ZONES_ENABLED,
  sosQuietZoneMode: SOS_IN_QUIET_ZONE_MODE,
  pingQuietZoneMode: PING_IN_QUIET_ZONE_MODE,
  quietZoneBufferM: QUIET_ZONE_BUFFER_M,
  pointZoneRadiusM: POINT_ZONE_RADIUS_M,
  locationMaxAgeSec: LOCATION_MAX_AGE_SEC,
  locationMaxAccuracyM: LOCATION_MAX_ACCURACY_M,
  pingCooldownSec: PING_COOLDOWN_SEC,
  pingMaxPerWindow: PING_MAX_PER_WINDOW,
  pingWindowMin: PING_WINDOW_MIN,
  classHours: CLASS_HOURS,
  timeZone: CLASS_TIME_ZONE,
  forceClassHours: FORCE_CLASS_HOURS,
  zones: QUIET_ZONES,
};

// --- Time ------------------------------------------------------------------------------------

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The weekday (0 = Sunday) and minutes since midnight at instant `ms` in `timeZone`. */
export function wallClock(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { day: WEEKDAYS[get('weekday')], minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

/** Whether instant `ms` falls in class time: a class day, from start up to (not including)
 *  end, and not inside a break. With `forced`, always. */
export function isClassHours(ms, { classHours, timeZone, forceClassHours = false }) {
  if (forceClassHours) return true;
  const { day, minutes } = wallClock(ms, timeZone);
  if (!classHours.days.includes(day)) return false;
  if (minutes < toMinutes(classHours.start) || minutes >= toMinutes(classHours.end)) return false;
  return !classHours.breaks.some((b) => minutes >= toMinutes(b.from) && minutes < toMinutes(b.to));
}

// --- Geometry ----------------------------------------------------------------------------------
// Campus-sized distances: a flat projection around the point is accurate to well under a metre.

const M_PER_DEG_LAT = 111320;

const project = (lat, lng, lat0) => ({
  x: lng * M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180),
  y: lat * M_PER_DEG_LAT,
});

function distanceToSegmentM(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insidePolygon(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Metres from (lat, lng) to a zone: 0 inside an outline, otherwise to its nearest edge;
 *  a zone without an outline is a circle of `pointRadiusM` around its point. */
export function distanceToZoneM(lat, lng, zone, pointRadiusM) {
  const p = project(lat, lng, lat);
  if (zone.footprint && zone.footprint.length >= 3) {
    const ring = zone.footprint.map(([la, ln]) => project(la, ln, lat));
    if (insidePolygon(p, ring)) return 0;
    let nearest = Infinity;
    for (let i = 0; i < ring.length - 1; i++) nearest = Math.min(nearest, distanceToSegmentM(p, ring[i], ring[i + 1]));
    // The ring's last point repeats its first in the database, but close it anyway.
    nearest = Math.min(nearest, distanceToSegmentM(p, ring[ring.length - 1], ring[0]));
    return nearest;
  }
  const c = project(zone.lat, zone.lng, lat);
  return Math.max(0, Math.hypot(p.x - c.x, p.y - c.y) - pointRadiusM);
}

/** The quiet zone (nearest first) that (lat, lng) is inside or within `bufferM` of, or null. */
export function quietZoneAt(lat, lng, zones, bufferM, pointRadiusM) {
  let best = null;
  let bestDistance = Infinity;
  for (const zone of zones) {
    const d = distanceToZoneM(lat, lng, zone, pointRadiusM);
    if (d <= bufferM && d < bestDistance) {
      best = zone;
      bestDistance = d;
    }
  }
  return best;
}

// --- The sender's position ---------------------------------------------------------------------

/** 'ok', or why the position can't be trusted: 'missing' | 'stale' | 'inaccurate'.
 *  location: { lat, lng, ageMs, accuracyM? } or null. accuracyM absent means unknown,
 *  which is not held against the sender. */
export function locationStatus(location, config) {
  if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) return 'missing';
  if (!Number.isFinite(location.ageMs) || location.ageMs > config.locationMaxAgeSec * 1000) return 'stale';
  if (Number.isFinite(location.accuracyM) && location.accuracyM > config.locationMaxAccuracyM) return 'inaccurate';
  return 'ok';
}

// --- The decision ------------------------------------------------------------------------------

const verdict = (mode, reasonCode, extra = {}) => ({ allowed: mode !== 'blocked', mode, reasonCode, ...extra });
const ALLOW = verdict('allow', null);

/**
 * @param {object} input
 * @param {'sos'|'ping'} input.type
 * @param {{ sosEnabled: boolean, pingEnabled: boolean }} input.settings the Group's switches
 * @param {boolean} [input.senderMuted] the Group Lead has muted this sender's pings
 * @param {{ lat: number, lng: number, ageMs: number, accuracyM?: number }|null} input.location
 *   the sender's last position as the server knows it
 * @param {{ lastToTargetAt?: number|null, recentAts?: number[] }} [input.history] the
 *   sender's allowed pings: when they last pinged THIS target, and when they pinged anyone
 * @param {number} input.now epoch ms (cooldowns)
 * @param {number} [input.classNow] epoch ms the class hours are judged on (defaults to now)
 * @param {object} [config] DEFAULT_RULES_CONFIG, or a variant of it
 */
export function evaluateAlertPermission(input, config = DEFAULT_RULES_CONFIG) {
  const { type, settings, senderMuted = false, location, history = {}, now } = input;
  const isSos = type === 'sos';

  // 1. The Group Lead's switches.
  if (isSos ? settings.sosEnabled === false : settings.pingEnabled === false) {
    return verdict('blocked', 'GROUP_DISABLED');
  }
  if (!isSos && senderMuted) return verdict('blocked', 'MEMBER_MUTED');

  // With quiet zones switched off there is no class-hours rule to apply, so none is judged.
  const inClass = config.quietZonesEnabled && isClassHours(input.classNow ?? now, config);
  const status = locationStatus(location, config);
  const zone = inClass && status === 'ok'
    ? quietZoneAt(location.lat, location.lng, config.zones, config.quietZoneBufferM, config.pointZoneRadiusM)
    : null;

  // 2. A quiet zone during class hours.
  if (zone) {
    const quietMode = isSos ? config.sosQuietZoneMode : config.pingQuietZoneMode;
    return verdict(quietMode, 'QUIET_ZONE', { zone: zone.name });
  }

  // 3. Ping only: how often.
  if (!isSos) {
    const cooldownMs = config.pingCooldownSec * 1000;
    const sinceLast = history.lastToTargetAt == null ? Infinity : now - history.lastToTargetAt;
    if (sinceLast < cooldownMs) {
      return verdict('blocked', 'COOLDOWN', { retryAfterSec: Math.ceil((cooldownMs - sinceLast) / 1000) });
    }
    const windowMs = config.pingWindowMin * 60 * 1000;
    const inWindow = (history.recentAts ?? []).filter((at) => now - at < windowMs).sort((a, b) => a - b);
    if (inWindow.length >= config.pingMaxPerWindow) {
      // Free again when the oldest of the ones that count falls out of the window.
      const oldestCounting = inWindow[inWindow.length - config.pingMaxPerWindow];
      return verdict('blocked', 'COOLDOWN', { retryAfterSec: Math.ceil((oldestCounting + windowMs - now) / 1000) });
    }
  }

  // 4. During class hours, a position that can't say where the sender is.
  if (inClass && status !== 'ok') {
    return isSos ? verdict('guarded', 'LOCATION_UNKNOWN') : verdict('blocked', 'LOCATION_UNKNOWN');
  }

  return ALLOW;
}
