// The files the in-app Floor 7 walk recorder writes, and how to read them back. Pure
// functions shared by the phone (src/utils/floor7Recorder.js) and the desktop script
// (scripts/floor7-phone-walk.mjs), so a recording reads on a PC exactly as the phone wrote it.
//
//   <id>_estimates.csv  one row per estimate
//   <id>_scans.csv      the campus access point readings behind them (each scan once)
//   <id>_doors.csv      the door marks and the continuous-walk marks
//   <id>_events.csv     app went to the background, came back, scans that gave nothing...
//   <id>_summary.txt    phone, build, constants in force, and the error report

import { parseCsv } from './floor7Anchors.mjs';
import { CATCH_UP_M, DEFAULT_DWELL_S, formatWalk, resolveDoor, scoreWalk, scoreWindows, summariseWalk } from './floor7PhoneWalk.mjs';

export const ESTIMATE_COLUMNS = [
  'at_ms', 'time', 'raw_x', 'raw_y', 'snap_edge', 'snap_offset_m', 'snap_x', 'snap_y',
  'filtered_x', 'filtered_y', 'shown', 'status', 'reason', 'walk_from_last_m', 'confidence',
  'matched_aps', 'total_aps', 'scans_merged', 'scans_used', 'uncertainty_m',
];
export const SCAN_COLUMNS = ['time', 'scan_at_ms', 'bssid', 'ssid', 'rssi_dbm', 'frequency_mhz'];
export const MARK_COLUMNS = ['kind', 'place_id', 'place_name', 'at_ms', 'time', 'dwell_s'];
export const EVENT_COLUMNS = ['at_ms', 'time', 'event', 'detail'];

const field = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Rows (objects or arrays, already in column order) -> CSV text with a header line. */
export const toCsv = (columns, rows) => `${[columns.join(','), ...rows.map((r) => r.map(field).join(','))].join('\n')}\n`;

const iso = (ms) => new Date(ms).toISOString();
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : '');

export function estimatesCsv(rows) {
  return toCsv(ESTIMATE_COLUMNS, rows.map((e) => [
    e.at, iso(e.at), r2(e.raw.x), r2(e.raw.y), e.snapped.edge, r2(e.snapped.offset), r2(e.snapped.x), r2(e.snapped.y),
    e.filtered ? r2(e.filtered.x) : '', e.filtered ? r2(e.filtered.y) : '', e.filtered ? 'position' : 'none',
    e.status, e.reason ?? '', r2(e.walkFromLastM), r2(e.confidence), e.matched, e.total, e.scansMerged,
    (e.scansUsed ?? []).join(';'), r2(e.unc),
  ]));
}

export function scansCsv(scans) {
  return toCsv(SCAN_COLUMNS, scans.flatMap((s) => s.aps.map((a) => [iso(s.at), s.at, a.bssid, a.ssid ?? '', a.rssi, a.frequency ?? ''])));
}

export function marksCsv(marks) {
  return toCsv(MARK_COLUMNS, marks.map((m) => [m.kind, m.placeId, m.placeName, m.at, iso(m.at), m.dwellS ?? '']));
}

export function eventsCsv(events) {
  return toCsv(EVENT_COLUMNS, events.map((e) => [e.at, iso(e.at), e.event, e.detail ?? '']));
}

const records = (text, firstColumn) => {
  const [header, ...body] = parseCsv(text).filter((r) => r.some((f) => f.trim() !== ''));
  if (!header || header[0].trim() !== firstColumn) return null;
  const cols = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ''])));
};
const num = (v) => (v === '' || v === undefined ? null : Number(v));

/** True for the text of an estimates file, false for anything else (an adb log, say). */
export const looksLikeEstimates = (text) => /^at_ms,/.test(text.trimStart());
/** True for the new doors file (header starts `kind`), false for the old `door,time` file. */
export const looksLikeMarks = (text) => /^kind,/.test(text.trimStart());

/**
 * The estimates file -> the same fix objects parseFixLog gives (plus the extra columns), so the
 * scoring code does not care which source it came from. `shown` "none" gives x and y null.
 */
export function parseEstimatesCsv(text) {
  const rows = records(text, 'at_ms');
  if (!rows) throw new Error('not an estimates file: the first column should be at_ms');
  return rows.map((r) => {
    const shown = r.shown === 'position';
    return {
      at: Number(r.at_ms), status: r.status, x: shown ? num(r.filtered_x) : null, y: shown ? num(r.filtered_y) : null,
      rawX: num(r.raw_x), rawY: num(r.raw_y), snapX: num(r.snap_x), snapY: num(r.snap_y), unc: num(r.uncertainty_m),
      reason: r.reason, walkFromLastM: num(r.walk_from_last_m), confidence: num(r.confidence),
      matched: num(r.matched_aps), total: num(r.total_aps), scansMerged: num(r.scans_merged),
    };
  }).sort((a, b) => a.at - b.at);
}

/**
 * The new doors file -> scoring windows and walks. `dwell_s` is the length of the window the
 * recorder worked out (Done pressed, or the default 75 s). Walk marks pair up in order:
 * each walk_start with the next walk_end.
 * @returns {{windows:{label:string,key:string,from:number,to:number}[], walks:{start:object,end:object}[]}}
 */
export function parseMarksCsv(text) {
  const rows = records(text, 'kind');
  if (!rows) throw new Error('not a doors file from the app: the first column should be kind');
  const windows = [];
  const walks = [];
  let open = null;
  for (const r of rows) {
    const at = Number(r.at_ms);
    const mark = { label: r.place_name || r.place_id, key: r.place_id || r.place_name, at };
    if (r.kind === 'door') {
      const dwell = r.dwell_s === '' ? DEFAULT_DWELL_S : Number(r.dwell_s);
      windows.push({ label: mark.label, key: mark.key, from: at, to: at + dwell * 1000 });
    } else if (r.kind === 'walk_start') open = mark;
    else if (r.kind === 'walk_end' && open) { walks.push({ start: open, end: mark }); open = null; }
  }
  return { windows, walks };
}

// ------------------------------------------------------------------ the report in words

const m1 = (v) => `${v.toFixed(1)} m`;

const verdict = (m) => (m <= 5 ? 'good (within 5 m)' : m <= 10 ? 'usable (within 10 m)' : 'too far off (over 10 m)');

/** One plain sentence per result, for the person holding the phone. */
export function explainResults(doorRows, walkRows = []) {
  const lines = [];
  for (const r of doorRows) {
    if (!r.shown) {
      lines.push(`${r.door}: no position was shown while you stood there (${r.fixesInWindow ? `last status ${r.status}` : 'no estimate arrived'}).`);
    } else {
      lines.push(`${r.door}: the dot ended ${m1(r.walkM)} from the door on foot, ${verdict(r.walkM)}. The raw estimate alone was ${m1(r.rawWalkM)} away.`);
    }
  }
  for (const w of walkRows) {
    const head = `Walk ${w.from} to ${w.to} (${Math.round(w.seconds)} s)`;
    if (!w.shown) lines.push(`${head}: no position was shown during the walk, so lag cannot be scored.`);
    else if (w.lagM <= CATCH_UP_M) lines.push(`${head}: at the end the dot was only ${m1(w.lagM)} behind you, so it kept up.`);
    else if (w.catchUpS === null) lines.push(`${head}: at the end the dot was ${m1(w.lagM)} behind you and had not caught up when the recording ended.`);
    else lines.push(`${head}: at the end the dot was ${m1(w.lagM)} behind you; it caught up (within ${CATCH_UP_M} m) ${Math.round(w.catchUpS)} s later.`);
  }
  return lines;
}

/**
 * Score a recording from its two files: the phone does this on Stop and the desktop script does
 * it from the shared files, with this one function, so the answers are the same.
 * @param {object} options plan: floor7Plan; scale: PLAN_SCALE; doc: the plan JSON (for place names)
 */
export function reportFromFiles({ estimatesText, marksText, plan, scale, doc }) {
  const fixes = parseEstimatesCsv(estimatesText);
  const { windows, walks } = parseMarksCsv(marksText);
  const resolve = (key) => resolveDoor(key, doc, null);
  const doorRows = scoreWindows({ windows, fixes, plan, scale, resolve });
  const walkRows = walks.map((walk) => scoreWalk({ walk, fixes, plan, scale, resolve }));
  return { fixes, doorRows, walkRows, text: formatReport(doorRows, walkRows) };
}

/** The whole error report as text: the table, the numbers, then what it means. */
export function formatReport(doorRows, walkRows = []) {
  const out = [];
  if (doorRows.length) {
    out.push(formatWalk(doorRows));
    const sum = summariseWalk(doorRows);
    if (sum?.noPosition.length) out.push('', `Doors with no position shown: ${sum.noPosition.join('; ')}`);
  } else out.push('No door marks were made, so there is nothing to score.');
  const words = explainResults(doorRows, walkRows);
  if (words.length) out.push('', 'What this means:', ...words.map((l) => `- ${l}`));
  return out.join('\n');
}
