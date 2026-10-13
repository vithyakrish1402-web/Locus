// The leave-one-scan-out replay and its cousins, as pure functions. For a survey scan: build
// the access point anchors WITHOUT it (or without a whole session), estimate where that scan
// was taken, snap the estimate onto the corridor, and measure the WALKING distance in metres
// to the plan spot the scan was really taken at. scripts/floor7-leave-one-out.mjs wires in
// the real estimator and prints the report.
//
// Caveats the report always repeats: plan distances are estimated, spot positions are good to
// a few metres at best, and every scan comes from the same people on the same day.

import { buildAnchors, guessReasons, radioOf } from './floor7Anchors.mjs';

/** Scan id -> { scan, file, point, time, phone, part, session, place, x, y, readings:[{bssid, rssi}] }. */
export function scansOf(placed) {
  const scans = new Map();
  for (const r of placed) {
    if (!scans.has(r.scan)) {
      scans.set(r.scan, { scan: r.scan, file: r.file, point: r.point, time: r.time, phone: r.phone, part: r.part, session: r.session, place: r.place, x: r.x, y: r.y, readings: [] });
    }
    scans.get(r.scan).readings.push({ bssid: r.bssid, rssi: r.rssi });
  }
  return scans;
}

/**
 * @param {object} options
 * @param {object[]} options.tests scan records to test (see scansOf)
 * @param {object[]} options.campus campus readings the anchors are built from
 * @param {(scan: object) => ((reading: object) => boolean)} options.trainFor which readings may
 *   build the anchors for this test scan
 * @param {(scan: object, radios: object[]) => ({x:number, y:number}|null)} options.estimate
 *   the estimate in plan metres (real metres, after PLAN_SCALE), or null for none
 * @param {object} options.plan floor7Plan (snapToCorridor, walkingDistance)
 * @param {number} options.scale PLAN_SCALE
 * @param {object} [options.anchorOptions] more for buildAnchors: `midpoint`, `minBestDbm`
 * @param {object} [options.planDoc] and `mapping`: to mark anchors that rest on a guess
 * @returns {object[]} one row per test scan
 */
export function evaluate({ tests, campus, trainFor, estimate, plan, scale, planDoc = null, mapping = null, anchorOptions = {} }) {
  const guessOf = new Map();
  const isGuess = (place) => {
    if (!guessOf.has(place)) guessOf.set(place, planDoc ? guessReasons(place, planDoc, mapping).length > 0 : false);
    return guessOf.get(place);
  };
  return tests.map((scan) => {
    const radios = buildAnchors(campus, { ...anchorOptions, use: trainFor(scan), planDoc, mapping });
    const est = estimate(scan, radios);
    const truth = { x: scan.x * scale, y: scan.y * scale };
    const heard = new Set(scan.readings.map((r) => radioOf(r.bssid)));
    const matched = radios.filter((r) => heard.has(r.radio));
    const row = {
      scan: scan.scan, session: scan.session, phone: scan.phone, part: scan.part, place: scan.place,
      truthIsGuess: isGuess(scan.place), matchedRadios: matched.length,
      guessShare: matched.length ? matched.filter((r) => r.guess.length > 0).length / matched.length : 0,
      anchorsForPlace: radios.filter((r) => r.place === scan.place || r.tie?.includes(scan.place)).length,
      est: null, walk: null, straight: null, moved: null,
    };
    if (!est) return row;
    const snapped = plan.snapToCorridor(est.x, est.y);
    return {
      ...row, est,
      straight: Math.hypot(est.x - truth.x, est.y - truth.y),
      moved: snapped.distanceMoved,
      walk: plan.walkingDistance(snapped, truth),
    };
  });
}

const sortNum = (xs) => [...xs].sort((a, b) => a - b);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = sortNum(xs);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** Nearest-rank percentile, p in 0..100. */
const percentile = (xs, p) => sortNum(xs)[Math.max(0, Math.ceil((p / 100) * xs.length) - 1)];

/** Summary of the walking errors of some rows. Rows without an estimate are counted apart. */
export function stats(rows) {
  const walks = rows.filter((r) => r.walk !== null).map((r) => r.walk);
  const base = { scans: rows.length, noEstimate: rows.length - walks.length };
  if (walks.length === 0) return { ...base, estimated: 0 };
  return {
    ...base,
    estimated: walks.length,
    median: median(walks),
    mean: mean(walks),
    p90: percentile(walks, 90),
    max: Math.max(...walks),
    within5: walks.filter((w) => w <= 5).length / walks.length,
    within10: walks.filter((w) => w <= 10).length / walks.length,
  };
}

/** Rows grouped by `keyOf(row)`; keys in first-seen order. */
export function groupBy(rows, keyOf) {
  const out = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

/**
 * The average walk between two different surveyed spots: what a blind guess of "some spot
 * on this floor" would cost, for scale. Uses each distinct spot once.
 */
export function blindGuessWalk(scans, plan, scale) {
  const spots = new Map();
  for (const s of scans.values()) spots.set(s.place, { x: s.x * scale, y: s.y * scale });
  const pts = [...spots.values()];
  const d = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) d.push(plan.walkingDistance(pts[i], pts[j]));
  return { spots: pts.length, mean: mean(d), median: median(d) };
}

/**
 * Replays scans in the order they were taken, as a walk: each estimate goes through the
 * position filter, and the filtered position is judged against where the scan really was.
 *
 * @param {object[]} rows evaluate() rows for the scans, with `est` ({x, y, confidence}|null)
 * @param {Map} scans scan id -> scan record (see scansOf), for the time and the true spot
 * @param {object} options
 * @param {object} options.plan floor7Plan
 * @param {number} options.scale PLAN_SCALE
 * @param {() => object} options.makeFilter a fresh position filter
 * @returns {object[]} one row per scan, in time order: { scan, place, time, gapS, truthStep,
 *   raw (walk error of the snapped raw estimate, or null), filtered (walk error of the filter's
 *   position), status ('no estimate' when there was none) }
 */
export function walkReplay({ rows, scans, plan, scale, makeFilter }) {
  const filter = makeFilter();
  const ordered = [...rows].sort((a, b) => scans.get(a.scan).time - scans.get(b.scan).time);
  let prev = null;
  return ordered.map((row) => {
    const scan = scans.get(row.scan);
    const truth = { x: scan.x * scale, y: scan.y * scale };
    const status = row.est ? filter.update({ x: row.est.x, y: row.est.y, confidence: row.est.confidence }, scan.time) : 'no estimate';
    const held = filter.position;
    const out = {
      scan: row.scan, place: row.place, time: scan.time,
      gapS: prev ? (scan.time - prev.time) / 1000 : null,
      truthStep: prev ? plan.walkingDistance(prev.truth, truth) : null,
      raw: row.walk,
      filtered: held ? plan.walkingDistance(held, truth) : null,
      status,
    };
    prev = { time: scan.time, truth };
    return out;
  });
}

/** Summary of a walk replay: raw against filtered over the scans that have both. */
export function compareWalk(walk) {
  const both = walk.filter((w) => w.raw !== null && w.filtered !== null);
  const raw = both.map((w) => w.raw);
  const filtered = both.map((w) => w.filtered);
  return {
    scans: walk.length,
    compared: both.length,
    rejected: walk.filter((w) => w.status === 'rejected').length,
    reacquired: walk.filter((w) => w.status === 'reacquiring').length,
    noEstimate: walk.filter((w) => w.status === 'no estimate').length,
    raw: both.length ? { median: median(raw), mean: mean(raw), p90: percentile(raw, 90), max: Math.max(...raw) } : null,
    filtered: both.length ? { median: median(filtered), mean: mean(filtered), p90: percentile(filtered, 90), max: Math.max(...filtered) } : null,
    better: both.filter((w) => w.filtered < w.raw - 0.5).length,
    worse: both.filter((w) => w.filtered > w.raw + 0.5).length,
  };
}
