// The phone walk: the team stands at each door of Floor 7 for a minute and writes down the
// time. The test build prints one console line per estimate (floor7Demo.js, marker "[F7]"),
// which adb logcat collects. This turns the two into an error in metres per door. Pure
// functions; scripts/floor7-phone-walk.mjs reads the files and prints.

import { parseCsv } from './floor7Anchors.mjs';

/** Prefixes the console line the app prints (floor7Demo.js FIX_LOG_MARKER). */
export const FIX_MARKER = '[F7]';

/** How long after the time you wrote down a door still counts as "standing there" (seconds). */
export const DEFAULT_DWELL_S = 75;

/**
 * Fixes out of `adb logcat -d -s Capacitor/Console` text (or the app's own lines): every line
 * with the marker followed by JSON. Anything else, including a line cut short, is skipped.
 * Sorted by time, repeats of the same estimate dropped.
 * @returns {{at:number, status:string, x:number|null, y:number|null, rawX:number, rawY:number,
 *   snapX:number, snapY:number, unc:number}[]}
 */
export function parseFixLog(text) {
  const seen = new Set();
  const fixes = [];
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(FIX_MARKER);
    if (i < 0) continue;
    const json = line.slice(line.indexOf('{', i));
    let fix;
    try {
      fix = JSON.parse(json);
    } catch {
      continue;
    }
    if (!Number.isFinite(fix?.at) || typeof fix.status !== 'string') continue;
    const key = `${fix.at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fixes.push(fix);
  }
  return fixes.sort((a, b) => a.at - b.at);
}

/** "16:47", "16:47:10" -> seconds since midnight; null when it is not a time. */
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text).trim());
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  return h < 24 && min < 60 && s < 60 ? h * 3600 + min * 60 + s : null;
}

/**
 * The doors file: `door,time` (and optionally a third column, the seconds you stood there).
 * The time is the wall clock of the computer running the script, on the day of the walk.
 * @returns {{door:string, clockS:number, dwellS:number}[]}
 */
export function parseDoors(text, defaultDwellS = DEFAULT_DWELL_S) {
  const rows = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ''));
  const [header, ...body] = rows;
  const first = header.map((h) => h.trim().toLowerCase());
  const hasHeader = first[0] === 'door';
  const data = hasHeader ? body : rows;
  return data.map((r, n) => {
    const clockS = parseClock(r[1] ?? '');
    if (clockS === null) throw new Error(`doors file, row ${n + 1 + (hasHeader ? 1 : 0)}: "${r[1] ?? ''}" is not a time like 16:47 or 16:47:10`);
    const dwell = r[2]?.trim() ? Number(r[2]) : defaultDwellS;
    if (!Number.isFinite(dwell) || dwell <= 0) throw new Error(`doors file: "${r[2]}" is not a number of seconds`);
    return { door: r[0].trim(), clockS, dwellS: dwell };
  });
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
/** A name with and without its bracket: "Room 706A (staff room)" is also "Room 706A". */
const forms = (s) => [norm(s), norm(String(s).replace(/\s*\([^)]*\)\s*/g, ' '))];

/**
 * Where a door is on the plan, in plan metres before PLAN_SCALE. A name is looked up in this
 * order, and the first step that finds exactly one place wins: a plan place id or name
 * (r706A, "Room 706A"), then the plan's other names for it (TP706A), then a survey spot name,
 * then a name in the survey name table. A name that fits several places at the same step
 * (the plan calls four of them "lift area near Room 703") is refused, naming them.
 * @returns {{name:string, x:number, y:number}}
 */
export function resolveDoor(name, planDoc, mapping = null) {
  const key = norm(name);
  const at = (p) => ({ name: p.name, x: p.front_point[0], y: p.front_point[1] });
  const steps = [
    planDoc.places.filter((p) => p.front_point && [p.id, ...forms(p.name)].some((n) => norm(n) === key || forms(n).includes(key))).map(at),
    planDoc.places.filter((p) => p.front_point && (p.aliases ?? []).some((n) => forms(n).includes(key))).map(at),
    planDoc.survey_spots.filter((s) => forms(s.name).includes(key) || norm(s.place_id) === key).map((s) => ({ name: s.name, x: s.point[0], y: s.point[1] })),
    mapping
      ? [...mapping.values()].filter((r) => norm(r.rawName) === key && !r.drop && r.x !== null).map((r) => ({ name: r.planName || r.rawName, x: r.x, y: r.y }))
      : [],
  ];
  for (const found of steps) {
    const distinct = [...new Map(found.map((f) => [`${f.x},${f.y}`, f])).values()];
    if (distinct.length === 1) return distinct[0];
    if (distinct.length > 1) throw new Error(`"${name}" fits several places: ${distinct.map((f) => f.name).join('; ')}. Use one of those names.`);
  }
  const known = [...new Set([...planDoc.places.map((p) => p.name), ...planDoc.survey_spots.map((s) => s.name)])].sort();
  throw new Error(`no door called "${name}" on the plan. Known names: ${known.join('; ')}`);
}

/** Epoch ms of `clockS` seconds after midnight on the given local calendar day. */
export const clockToEpoch = (year, month, day, clockS) =>
  new Date(year, month - 1, day, Math.floor(clockS / 3600), Math.floor((clockS % 3600) / 60), clockS % 60).getTime();

/**
 * Scores every door. For a door, the fixes logged from the moment you wrote down until
 * `dwellS` later are "while standing there". The score is for the LAST of them that showed a
 * position (the one the filter had settled on by the time you left), as a walk along the
 * corridors and as a straight line, next to the same for the raw estimate snapped onto the
 * corridor, so you can see what the filter did.
 *
 * @param {object} options
 * @param {{door:string, clockS:number, dwellS:number}[]} options.doors
 * @param {object[]} options.fixes from parseFixLog
 * @param {number[]} options.day [year, month, day] the walk was on
 * @param {object} options.plan floor7Plan (walkingDistance), in real metres
 * @param {number} options.scale PLAN_SCALE
 * @param {(name: string) => {name:string, x:number, y:number}} options.resolve
 */
export function scoreDoors({ doors, fixes, day, plan, scale, resolve }) {
  return doors.map(({ door, clockS, dwellS }) => {
    const from = clockToEpoch(...day, clockS);
    const to = from + dwellS * 1000;
    const spot = resolve(door);
    const truth = { x: spot.x * scale, y: spot.y * scale };
    const inWindow = fixes.filter((f) => f.at >= from && f.at <= to);
    const shown = inWindow.filter((f) => f.x !== null && f.x !== undefined);
    const base = { door, place: spot.name, from, fixesInWindow: inWindow.length };
    if (shown.length === 0) {
      return { ...base, status: inWindow.length ? inWindow.at(-1).status : 'no estimate', shown: false };
    }
    const fix = shown.at(-1);
    const rawWalk = plan.walkingDistance({ x: fix.snapX, y: fix.snapY }, truth);
    return {
      ...base,
      shown: true,
      status: fix.status,
      secondsIn: (fix.at - from) / 1000,
      walkM: plan.walkingDistance({ x: fix.x, y: fix.y }, truth),
      straightM: Math.hypot(fix.x - truth.x, fix.y - truth.y),
      rawWalkM: rawWalk,
      shownAt: { x: fix.x, y: fix.y },
    };
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** The printable table and summary for scoreDoors() rows. */
export function formatWalk(rows) {
  const m = (v) => `${v.toFixed(1)} m`;
  const lines = ['door                              fixes  when      status       shown error (walk)  straight  raw estimate (walk)', '-'.repeat(104)];
  for (const r of rows) {
    const name = `${r.door}${r.place && !r.place.toLowerCase().includes(r.door.toLowerCase()) ? ` (${r.place})` : ''}`.slice(0, 33).padEnd(33);
    if (!r.shown) {
      lines.push(`${name} ${String(r.fixesInWindow).padStart(5)}  -         ${String(r.status).padEnd(12)} no position shown`);
    } else {
      lines.push(`${name} ${String(r.fixesInWindow).padStart(5)}  +${String(Math.round(r.secondsIn)).padStart(3)} s    ${String(r.status).padEnd(12)} ${m(r.walkM).padStart(18)}  ${m(r.straightM).padStart(8)}  ${m(r.rawWalkM).padStart(18)}`);
    }
  }
  const shown = rows.filter((r) => r.shown);
  lines.push('-'.repeat(104));
  if (shown.length) {
    const errs = shown.map((r) => r.walkM);
    const raws = shown.map((r) => r.rawWalkM);
    lines.push(`${shown.length} of ${rows.length} doors showed a position.`);
    lines.push(`shown error (walk):  median ${m(median(errs))}, mean ${m(errs.reduce((a, b) => a + b, 0) / errs.length)}, worst ${m(Math.max(...errs))}, within 5 m: ${errs.filter((e) => e <= 5).length}, within 10 m: ${errs.filter((e) => e <= 10).length}`);
    lines.push(`raw estimate (walk): median ${m(median(raws))}, mean ${m(raws.reduce((a, b) => a + b, 0) / raws.length)}, worst ${m(Math.max(...raws))}`);
  } else {
    lines.push('No door showed a position. Check the times in the doors file against the phone clock, and that the log has [F7] lines.');
  }
  return lines.join('\n');
}
