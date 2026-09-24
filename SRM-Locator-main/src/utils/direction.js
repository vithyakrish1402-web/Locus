// Words and angles for "where is my squadmate?" on the squad roster (SquadMemberCard.jsx).

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const wrap360 = (deg) => ((deg % 360) + 360) % 360;

/** 0-360 bearing -> the nearest of the eight compass points. */
export function compassPoint(bearing) {
  if (!Number.isFinite(bearing)) return null;
  return POINTS[Math.round(wrap360(bearing) / 45) % 8];
}

/**
 * Where something is relative to the way the phone faces, as a clock face: 12 is straight
 * ahead, 3 is to the right, 6 behind. Easier to act on while walking than a bearing.
 * @returns {{hour:number, label:string}|null}
 */
export function relativeClock(bearing, heading) {
  if (!Number.isFinite(bearing) || !Number.isFinite(heading)) return null;
  const relative = wrap360(bearing - heading);
  const hour = Math.round(relative / 30) % 12 || 12;
  const label = hour === 12 ? 'AHEAD' : hour === 6 ? 'BEHIND' : `${hour} O'CLOCK`;
  return { hour, label };
}

/**
 * The next angle for a rotating arrow: the target expressed on the same unwrapped scale as
 * `previous`, so the arrow always turns the short way (359° -> 1° is +2°, not -358°).
 */
export function continuousAngle(previous, target) {
  if (!Number.isFinite(target)) return previous;
  if (!Number.isFinite(previous)) return wrap360(target);
  let delta = wrap360(target - previous);
  if (delta > 180) delta -= 360;
  return previous + delta;
}

/** Signal freshness from a last-seen time (epoch ms): text plus a severity for styling. */
export function freshness(lastSeen, now = Date.now()) {
  if (!Number.isFinite(lastSeen)) return { text: 'NO SIGNAL YET', level: 'none' };
  const seconds = Math.max(0, Math.floor((now - lastSeen) / 1000));
  if (seconds < 10) return { text: 'LIVE', level: 'live' };
  if (seconds < 60) return { text: `${seconds}s AGO`, level: 'recent' };
  if (seconds < 300) return { text: `${Math.floor(seconds / 60)}m AGO`, level: 'stale' };
  return { text: `${Math.floor(seconds / 60)}m AGO`, level: 'lost' };
}

/** Metres -> a short readout: { value, unit }, in KM from 1 km. */
export function formatMetres(metres) {
  if (!Number.isFinite(metres)) return null;
  if (metres >= 1000) return { value: (metres / 1000).toFixed(metres >= 10000 ? 0 : 1), unit: 'KM' };
  return { value: String(Math.round(metres)), unit: 'M' };
}

/**
 * Squad members nearest first, by straight-line distance from `me`. Members without a fix
 * (or with no position of our own to measure from) keep their order and go last.
 */
export function sortByDistance(members, me) {
  const located = (m) => m.hasFix && Number.isFinite(m.lat) && Number.isFinite(m.lng);
  if (!me || !Number.isFinite(me.lat) || !Number.isFinite(me.lng)) return [...members];
  const d2 = (m) => (m.lat - me.lat) ** 2 + ((m.lng - me.lng) * Math.cos((me.lat * Math.PI) / 180)) ** 2;
  const withFix = members.filter(located).sort((x, y) => d2(x) - d2(y));
  return [...withFix, ...members.filter((m) => !located(m))];
}
