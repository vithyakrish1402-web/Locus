// Every tunable of the SOS / Ping guard (alertRules.js), in one place.
//
// Each number can be overridden by an environment variable of the same name prefixed with
// LOCUS_ (LOCUS_PING_COOLDOWN_SEC=30). That exists for the e2e tests, which cannot wait
// minutes, and for tuning on Render without a redeploy of code. Nothing here is a secret.
//
// The campus timetable (CLASS_HOURS) and the quiet-zone building list
// (QUIET_ZONE_BUILDING_IDS) below are PLACEHOLDERS until the real ones are confirmed.
// That is why the whole quiet-zone feature is OFF unless LOCUS_QUIET_ZONES_ENABLED=true.

import { SRM_MASTER_DATABASE } from '../src/srmDatabase.js';

const number = (name, fallback) => {
  const raw = process.env[`LOCUS_${name}`];
  const value = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const mode = (name, fallback) => {
  const raw = process.env[`LOCUS_${name}`];
  return raw === 'guarded' || raw === 'blocked' ? raw : fallback;
};

// --- Master switch for quiet zones ----------------------------------------------------
// OFF by default, so merging this to the server changes nothing near classrooms until it is
// turned on on purpose (LOCUS_QUIET_ZONES_ENABLED=true). Off, two rules are skipped
// entirely: the quiet-zone rule, and the class-hours rule for a missing or stale position
// (which exists only to decide whether someone is in a quiet zone). Everything else is
// always on: the Group Lead's switches and mutes, the Ping cooldown and cap, SOS
// coalescing, the repeated-SOS notice, and the alert log. LOCUS_FORCE_CLASS_HOURS does
// nothing while this is off, because there are no class-hour rules left to force.
export const QUIET_ZONES_ENABLED = process.env.LOCUS_QUIET_ZONES_ENABLED === 'true';

// --- What an alert does inside a quiet zone during class hours -----------------------
// 'guarded': an SOS still goes out, flagged as sent from a class zone. 'blocked': it does not.
export const SOS_IN_QUIET_ZONE_MODE = mode('SOS_IN_QUIET_ZONE_MODE', 'guarded');
export const PING_IN_QUIET_ZONE_MODE = mode('PING_IN_QUIET_ZONE_MODE', 'blocked');

// Margin around a teaching building's outline that still counts as "near classrooms".
export const QUIET_ZONE_BUFFER_M = number('QUIET_ZONE_BUFFER_M', 30);
// A building mapped as a single point (no outline) is treated as a circle of this radius,
// before the buffer is added.
export const POINT_ZONE_RADIUS_M = number('POINT_ZONE_RADIUS_M', 40);

// --- How far to trust the sender's last position --------------------------------------
export const LOCATION_MAX_AGE_SEC = number('LOCATION_MAX_AGE_SEC', 120);
// Only applied when the phone reports an accuracy. Installed builds before Stage 2 do
// not, and a missing accuracy is "unknown", never "bad".
export const LOCATION_MAX_ACCURACY_M = number('LOCATION_MAX_ACCURACY_M', 60);

// --- Ping limits ----------------------------------------------------------------------
// Cooldown is per sender AND target: pinging two different people in a row is two
// different intentions, while the same person twice within the cooldown is the buzz this
// exists to stop. PING_MAX_PER_WINDOW then caps the sender overall.
export const PING_COOLDOWN_SEC = number('PING_COOLDOWN_SEC', 20);
export const PING_MAX_PER_WINDOW = number('PING_MAX_PER_WINDOW', 8);
export const PING_WINDOW_MIN = number('PING_WINDOW_MIN', 10);

// --- SOS handling (never rate-limited, only coalesced and counted) --------------------
export const SOS_COALESCE_SEC = number('SOS_COALESCE_SEC', 60);
export const SOS_REPEAT_FLAG_COUNT = number('SOS_REPEAT_FLAG_COUNT', 3);
export const SOS_REPEAT_WINDOW_MIN = number('SOS_REPEAT_WINDOW_MIN', 15);

// How many SOS/Ping decisions each Group's log keeps for its Group Lead.
export const ALERT_LOG_SIZE = number('ALERT_LOG_SIZE', 50);

// How long a Group's saved settings can be restored after the Group itself is gone.
export const SETTINGS_RESTORE_TTL_HOURS = number('SETTINGS_RESTORE_TTL_HOURS', 24);

// --- Class hours ------------------------------------------------------------------------
// PLACEHOLDER — confirm with Krish. Monday to Saturday, 08:30-16:30, no breaks. Replace
// with the real timetable.
// Always read as Asia/Kolkata wall-clock time, whatever zone the server runs in (Render
// runs in UTC). days: 0 = Sunday ... 6 = Saturday. Times are "HH:MM". A break is a window
// inside the day when classes are not in session, e.g. { from: '12:30', to: '13:30' }.
export const CLASS_TIME_ZONE = 'Asia/Kolkata';
export const CLASS_HOURS = {
  days: [1, 2, 3, 4, 5, 6],
  start: '08:30',
  end: '16:30',
  breaks: [],
};

// --- Demo / test overrides (never on by accident) -----------------------------------------
// FORCE_CLASS_HOURS makes every moment count as class time, to demonstrate or test the
// guard at any hour. It needs LOCUS_FORCE_CLASS_HOURS=true, and on a server that says it is
// in production (NODE_ENV=production) ALSO LOCUS_ALLOW_FORCE_IN_PRODUCTION=true: two
// deliberate settings, so neither a stray variable nor a copied environment can turn it on.
// A refused attempt is logged and the guard simply follows the real clock.
export function forceClassHoursStatus(env = process.env) {
  if (env.LOCUS_FORCE_CLASS_HOURS !== 'true') return { forced: false, refused: false };
  if (env.NODE_ENV === 'production' && env.LOCUS_ALLOW_FORCE_IN_PRODUCTION !== 'true') {
    return { forced: false, refused: true };
  }
  return { forced: true, refused: false };
}
export const FORCE_CLASS_HOURS = forceClassHoursStatus().forced;

// The clock class hours are judged on, for the e2e tests only: LOCUS_CLASS_CLOCK_ISO pins
// it to one instant, so a test of the existing ping/SOS behaviour does not depend on the
// time of day it runs at. Cooldowns always use the real clock. Logged loudly at startup.
export function classClock(env = process.env) {
  const pinned = Date.parse(env.LOCUS_CLASS_CLOCK_ISO ?? '');
  return Number.isFinite(pinned) ? pinned : null;
}

// --- Quiet zones -----------------------------------------------------------------------------
// PLACEHOLDER — confirm with Krish. The teaching buildings, by id in src/srmDatabase.js.
// Deliberately NOT in it for now: University Building, Central Library, Dental college,
// Medical college, hospitals, the auditorium. Hostels, food
// court, grounds, parking, the hospital and the auditorium are deliberately not here.
// Outlines come from the same database the map uses; a building without one (32, 39) is a
// circle of POINT_ZONE_RADIUS_M around its point.
export const QUIET_ZONE_BUILDING_IDS = [
  2, // TECH PARK
  31, // TECH PARK 2
  32, // C V RAMAN BLOCK (point only)
  33, // MBA BLOCK
  39, // VALLIAMMAI ENGINEERING COLLEGE (point only)
  5, // ELECTRICAL SCIENCES BLOCK
  6, // MECHANICAL ENGINEERING BLOCK
  7, // BASIC ENGINEERING LAB
  8, // SCHOOL OF ARCHITECTURE
  9, // HI-TECH BLOCK
  10, // BIO-TECH BLOCK
  11, // AEROSPACE BLOCK
];

export const QUIET_ZONES = QUIET_ZONE_BUILDING_IDS
  .map((id) => SRM_MASTER_DATABASE.find((b) => b.id === id))
  .filter(Boolean)
  .map((b) => ({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, footprint: b.footprint ?? null }));

// The one line the server logs at startup: which rule groups are in force, and whether the
// quiet-zone switch and the class-hours override are on.
export function guardStartupLine({ quietZonesEnabled, forceClassHours }) {
  const always = 'Group switches and mutes, Ping cooldown and cap, SOS coalescing, repeated-SOS notice, alert log';
  const zones = quietZonesEnabled
    ? 'quiet zones + class-hours position rule ON'
    : 'quiet zones + class-hours position rule OFF (LOCUS_QUIET_ZONES_ENABLED is not "true")';
  const force = forceClassHours
    ? (quietZonesEnabled ? 'FORCE_CLASS_HOURS ON' : 'FORCE_CLASS_HOURS ON but has no effect while quiet zones are off')
    : 'FORCE_CLASS_HOURS off';
  return `[GUARD] Always on: ${always}. Switchable: ${zones}. ${force}.`;
}
