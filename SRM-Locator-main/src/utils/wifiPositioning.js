// WiFi Arc Stage 5: turns recent WifiScan results into an estimated position, using the
// surveyed access points in the Firestore `wifi_aps` collection. Estimation only - when
// to trust this over GPS, and anything to do with the map or `update-location`, is
// Stage 6.
//
//   const estimate = await estimateWifiPosition([scanA.aps, scanB.aps]);
//   // { lat, lng, building, floor, confidence, matchedApCount, totalApsSeen }
//
// This is a proximity-weighted centroid, not trilateration. Each surveyed AP sits at the
// survey point where it was heard strongest, so the estimate can only be as fine as the
// survey grid (16 distinct points in the first export).
//
// Two findings from the Stage 4 device test shape it:
//   - One scan is thin: standing still produced 1-9 APs per scan, with 56-100% overlap
//     between consecutive scans. So the entry point takes SEVERAL recent scans and merges
//     them, strongest reading per BSSID.
//   - 11 APs are `ambiguousFloor` (their best sighting was nearly as strong on an adjacent
//     floor). They keep full weight for lat/lng, but count at AMBIGUOUS_FLOOR_WEIGHT in the
//     floor vote, and the weight they lose counts as doubt in `confidence`.
//
// The pure estimator (estimatePosition) is separate from the Firestore cache, so the
// maths is tested without any Firebase at all.

import { collection, getDocsFromServer } from 'firebase/firestore';
import { auth, db } from '../firebase.js';

export const COLLECTION = 'wifi_aps';

// ---------------------------------------------------------------- tuning (v1 assumptions)

/**
 * RSSI -> weight: 2^((rssi + 100) / 10). Every 10 dB stronger doubles an AP's pull, so
 * the nearest AP dominates without silencing the rest: -100 dBm -> 1, -70 -> 8, -40 -> 64.
 */
export function rssiWeight(rssi) {
  return 2 ** ((rssi + 100) / 10);
}

/** Floor-vote multiplier for `ambiguousFloor` APs. The lat/lng centroid ignores it. */
export const AMBIGUOUS_FLOOR_WEIGHT = 0.5;

/** Matched APs at which the count stops adding confidence. 1 AP scores 1/5 of it. */
export const FULL_CONFIDENCE_AP_COUNT = 5;

// ---------------------------------------------------------------- estimation (pure)

/** What an estimate looks like when nothing scanned is in wifi_aps: valid, and useless. */
const noEstimate = (totalApsSeen) => ({
  lat: null,
  lng: null,
  building: null,
  floor: null,
  confidence: 0,
  matchedApCount: 0,
  totalApsSeen,
});

/**
 * Merges several scans into one reading per BSSID, keeping the STRONGEST RSSI rather than
 * an average: a stronger reading says more about where the phone is than a weaker one
 * from a moment when something was in the way.
 *
 * @param {Array} scans each one the `aps` array from WifiScan.scan(). A whole scan result
 *   is accepted too; one without `aps` (throttled, stale, timeout) contributes nothing, as
 *   does any entry that isn't a usable {bssid, rssi}.
 * @returns {Map<string, number>} lowercase BSSID -> strongest RSSI (dBm)
 */
export function mergeScans(scans) {
  const strongest = new Map();
  for (const scan of Array.isArray(scans) ? scans : []) {
    const aps = Array.isArray(scan) ? scan : scan?.aps;
    if (!Array.isArray(aps)) continue;
    for (const ap of aps) {
      if (typeof ap?.bssid !== 'string' || !Number.isFinite(ap.rssi)) continue;
      const bssid = ap.bssid.toLowerCase();
      const previous = strongest.get(bssid);
      if (previous === undefined || ap.rssi > previous) strongest.set(bssid, ap.rssi);
    }
  }
  return strongest;
}

/**
 * Estimates position from recent scans against a table of surveyed APs. Never throws:
 * a scan with nothing in the table is an expected outcome (hotspots, unsurveyed places)
 * and yields confidence 0.
 *
 * - lat/lng: weighted centroid of the matched APs, every AP at full weight.
 * - building + floor: categorical vote on (building, floor) PAIRS - floor 1 of one
 *   building is no evidence for floor 1 of another, so floor numbers are never pooled
 *   across buildings. Each pair sums its APs' weights (ambiguousFloor APs at
 *   AMBIGUOUS_FLOOR_WEIGHT) and the heaviest wins. An AP heard strongest outdoors has a
 *   null building and floor, and that pair can win too. An exact tie goes to the lower
 *   building name, then the lower floor, nulls last. One limit the data imposes: every
 *   survey building not in SRM_MASTER_DATABASE is tagged "OTHER", so those share a pair.
 * - confidence, 0..1: (matched APs, capped at FULL_CONFIDENCE_AP_COUNT, as a fraction of
 *   it) x (the winning pair's share of the vote). The share is measured against every
 *   matched AP at FULL weight, so the half an ambiguous AP holds back counts as doubt:
 *   a unanimous vote from ambiguous APs alone scores 0.5, a two-floor near-tie about 0.5,
 *   and a single AP at most 0.2.
 *
 * Only pass scans recent enough to describe where the phone is now: the strongest-wins
 * merge will happily keep a strong reading from a room the phone has since left.
 *
 * @param {Array} scans see mergeScans
 * @param {Map<string, {lat:number, lng:number, building:string|null, floor:number|null,
 *   ambiguousFloor:boolean}>} aps surveyed APs by lowercase BSSID
 * @returns {{lat:number|null, lng:number|null, building:string|null, floor:number|null,
 *   confidence:number, matchedApCount:number, totalApsSeen:number}}
 */
export function estimatePosition(scans, aps) {
  const readings = mergeScans(scans);

  const matched = [];
  for (const [bssid, rssi] of readings) {
    const ap = aps?.get(bssid);
    if (ap) matched.push({ ap, weight: rssiWeight(rssi) });
  }
  if (matched.length === 0) return noEstimate(readings.size);

  let totalWeight = 0;
  let latSum = 0;
  let lngSum = 0;
  const votes = new Map(); // JSON of [building, floor] -> { building, floor, weight }
  for (const { ap, weight } of matched) {
    totalWeight += weight;
    latSum += ap.lat * weight;
    lngSum += ap.lng * weight;
    const key = JSON.stringify([ap.building, ap.floor]);
    let vote = votes.get(key);
    if (!vote) votes.set(key, (vote = { building: ap.building, floor: ap.floor, weight: 0 }));
    vote.weight += ap.ambiguousFloor ? weight * AMBIGUOUS_FLOOR_WEIGHT : weight;
  }

  const nullsLast = (a, b) => (a === null) - (b === null);
  const winner = [...votes.values()].sort(
    (a, b) =>
      b.weight - a.weight ||
      nullsLast(a.building, b.building) ||
      (a.building ?? '').localeCompare(b.building ?? '', 'en') ||
      nullsLast(a.floor, b.floor) ||
      a.floor - b.floor
  )[0];

  const countFactor = Math.min(matched.length, FULL_CONFIDENCE_AP_COUNT) / FULL_CONFIDENCE_AP_COUNT;
  return {
    lat: latSum / totalWeight,
    lng: lngSum / totalWeight,
    building: winner.building,
    floor: winner.floor,
    confidence: countFactor * (winner.weight / totalWeight),
    matchedApCount: matched.length,
    totalApsSeen: readings.size,
  };
}

// ---------------------------------------------------------------- wifi_aps cache

/**
 * The surveyed APs, fetched once and kept for the life of the JS context. Module scope,
 * like the update hooks' cold-start throttle: it survives React remounts and dies with the
 * process. The collection only changes when someone re-runs the seed script, so there is
 * no polling; refreshAccessPoints() re-reads it on demand (e.g. from an app-resume
 * listener).
 */
let cachedAps = null;
let inFlight = null;

/** Exported for tests, which need each case to start from an empty cache. */
export function __resetAccessPointCache() {
  cachedAps = null;
  inFlight = null;
}

/**
 * One Firestore document -> one table entry, or null to leave it out. The seed validates
 * every row, but documents can be hand-edited in the console, so a bad one is skipped
 * rather than allowed to break or skew every estimate. A missing `ambiguousFloor` is read
 * as ambiguous: the seed script's rule is that "trust this AP's floor" is never a default.
 */
function toAccessPoint(data) {
  if (!Number.isFinite(data?.lat) || !Number.isFinite(data?.lng)) return null;
  const floor = data.floor ?? null;
  if (floor !== null && !Number.isInteger(floor)) return null;
  const building = data.building ?? null;
  if (building !== null && typeof building !== 'string') return null;
  return { lat: data.lat, lng: data.lng, building, floor, ambiguousFloor: data.ambiguousFloor !== false };
}

async function fetchAccessPoints() {
  // wifi_aps is readable only when signed in. On a cold start Firebase restores the saved
  // session asynchronously and currentUser is null until it has, so wait for that instead
  // of letting an early call be refused.
  await auth.authStateReady();
  if (!auth.currentUser) {
    throw Object.assign(new Error('wifi_aps can only be read when signed in'), { code: 'unauthenticated' });
  }
  // FromServer, not getDocs(): offline, getDocs() may answer from the local cache, which
  // for a collection never read is an empty result - and that would be cached here as
  // "no surveyed APs exist" until the next refresh. This rejects ('unavailable') instead.
  const snapshot = await getDocsFromServer(collection(db, COLLECTION));
  const table = new Map();
  for (const doc of snapshot.docs) {
    const ap = toAccessPoint(doc.data());
    if (ap) table.set(doc.id.toLowerCase(), ap); // the document ID is the BSSID
  }
  return table;
}

/**
 * The surveyed-AP table, from memory after the first successful read. Concurrent callers
 * share one read. A failed read is never cached - the next call tries again - and a
 * failed refresh leaves the previous table in place.
 *
 * Rejects with err.code 'unauthenticated' when no one is signed in, or with the Firestore
 * error's own code ('unavailable' offline, 'permission-denied' if the rules refuse).
 *
 * @param {{force?: boolean}} [options] force re-reads even when a table is cached
 * @returns {Promise<Map<string, {lat:number, lng:number, building:string|null, floor:number|null,
 *   ambiguousFloor:boolean}>>}
 */
export function loadAccessPoints({ force = false } = {}) {
  if (cachedAps && !force) return Promise.resolve(cachedAps);
  if (!inFlight) {
    inFlight = fetchAccessPoints()
      .then((table) => {
        cachedAps = table;
        return table;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Re-reads wifi_aps, for when it may have been re-seeded while the app was running. */
export function refreshAccessPoints() {
  return loadAccessPoints({ force: true });
}

/**
 * The entry point: estimatePosition against the cached table, loading it on first use.
 * Rejects only when the table can't be loaded (see loadAccessPoints) - which is not the
 * same as "nothing matched", and a caller may want to retry it.
 *
 * @param {Array} scans see mergeScans
 */
export async function estimateWifiPosition(scans) {
  return estimatePosition(scans, await loadAccessPoints());
}
