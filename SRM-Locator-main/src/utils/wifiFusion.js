// WiFi Arc Stage 6: decides, update by update, whether `update-location` carries the
// phone's GPS fix or Stage 5's WiFi estimate. Loaded only when WIFI_POSITIONING_ENABLED
// (src/utils/positionSource.js) is on; see src/hooks/useWifiFusion.js.
//
// V1 is a HARD SWITCH: a WiFi estimate at or above WIFI_CONFIDENCE_THRESHOLD replaces the
// GPS position outright (positionSource 'wifi'), and anything less leaves GPS untouched
// ('gps'). 'fused' - a partial-weight blend of the two - is reserved for a later stage and
// is never produced here. That is a scope decision, not an oversight.
//
// The loop: every WIFI_SCAN_INTERVAL_MS, one WifiScan.scan(), paced against the OS budget
// (scanBudget in wifiScan.js, 4 scans per rolling 2 minutes) rather than a second
// throttle of our own. Fresh scans go into a short rolling buffer, and the whole buffer
// goes to estimateWifiPosition, which merges several scans by design. Every cycle ends
// with a WiFi estimate or with none, and "none" means GPS: a scan that is empty, throttled,
// stale, timed out or refused, and a wifi_aps table that won't load (offline, signed out),
// all fall back to GPS for that cycle and never stop the loop.

import { WifiScan, isWifiScanAvailable, scanBudget, SCAN_WINDOW_MS } from './wifiScan.js';
import { estimateWifiPosition, loadAccessPoints, surveyedFloors } from './wifiPositioning.js';
import { SRM_MASTER_DATABASE } from '../srmDatabase.js';
import { WIFI_CONFIDENCE_THRESHOLD } from './positionSource.js';

// ---------------------------------------------------------------- tuning (v1 assumptions)

// WIFI_CONFIDENCE_THRESHOLD lives in positionSource.js so the Stage 7 map UI can scale its
// halo against it without importing this module; it is re-exported here for callers.
export { WIFI_CONFIDENCE_THRESHOLD };

/**
 * Time between scans. 35 s spends at most 4 scans in any 2 minutes only at the very edge
 * (0, 35, 70, 105 s), and usually 3, so it stays under the OS budget (4 per 2 minutes)
 * with margin for timer drift and for a scan the OS counts slightly differently. 30 s
 * would be exactly the budget. The budget check in runCycle skips a cycle rather than let
 * one be refused either way.
 */
export const WIFI_SCAN_INTERVAL_MS = 35_000;

/** How many recent fresh scans are merged into one estimate. */
export const WIFI_SCAN_BUFFER_SIZE = 3;

/**
 * Buffered scans older than this are dropped, however few remain. A full buffer spans
 * about this long, so it only bites when cycles stop (app backgrounded, timers paused):
 * the merge keeps the strongest reading per AP, and a strong one from a room the phone
 * has left would otherwise pull the next estimate back there.
 */
export const WIFI_SCAN_MAX_AGE_MS = WIFI_SCAN_BUFFER_SIZE * WIFI_SCAN_INTERVAL_MS;

/**
 * An estimate older than this is ignored. Cycles replace it every WIFI_SCAN_INTERVAL_MS,
 * so it only ages when they stop - and then a GPS fix arriving on resume must not be
 * swapped for where the phone was before it was put away.
 */
export const WIFI_ESTIMATE_MAX_AGE_MS = 2 * WIFI_SCAN_INTERVAL_MS;

// ---------------------------------------------------------------- the switch (pure)

/**
 * @param {{lat:number, lng:number}} gps
 * @param {{lat:number|null, lng:number|null, confidence:number}|null} estimate
 * @param {number} [threshold]
 * @returns {{lat:number, lng:number, positionSource:'gps'|'wifi'}} never any other source
 */
export function choosePosition(gps, estimate, threshold = WIFI_CONFIDENCE_THRESHOLD) {
  if (
    estimate &&
    estimate.confidence >= threshold &&
    Number.isFinite(estimate.lat) &&
    Number.isFinite(estimate.lng)
  ) {
    return { lat: estimate.lat, lng: estimate.lng, positionSource: 'wifi' };
  }
  return { lat: gps.lat, lng: gps.lng, positionSource: 'gps' };
}

// ---------------------------------------------------------------- indoor (Stage 7)

const KNOWN_BUILDINGS = new Set(SRM_MASTER_DATABASE.map((b) => b.name));

/**
 * The indoor reading behind Stage 7's map UI, or null. Stricter than choosePosition: on top
 * of a position WiFi would be trusted for, it needs a building from SRM_MASTER_DATABASE and
 * a whole-number floor. An "OTHER" or outdoor estimate can still move the broadcast position
 * (that is Stage 6's switch, unchanged), but it has no floor to show or send.
 *
 * @param {object|null} estimate a fresh Stage 5 estimate, with `floors` from the survey
 * @returns {{lat:number, lng:number, building:string, floor:number, confidence:number,
 *   floors:number[]}|null}
 */
export function indoorReading(estimate, threshold = WIFI_CONFIDENCE_THRESHOLD) {
  if (choosePosition({ lat: NaN, lng: NaN }, estimate, threshold).positionSource !== 'wifi') return null;
  if (!KNOWN_BUILDINGS.has(estimate.building) || !Number.isInteger(estimate.floor)) return null;
  const floors = Array.isArray(estimate.floors) ? estimate.floors.filter(Number.isInteger) : [];
  if (!floors.includes(estimate.floor)) floors.push(estimate.floor);
  return {
    lat: estimate.lat,
    lng: estimate.lng,
    building: estimate.building,
    floor: estimate.floor,
    confidence: estimate.confidence,
    floors: floors.sort((a, b) => a - b),
  };
}

// ---------------------------------------------------------------- the loop

/**
 * Starts scanning and returns the controller the emit sites read from. Everything it
 * touches is injectable so tests can drive it without a phone or Firestore.
 *
 * @returns {{resolve(gps): {lat:number, lng:number, positionSource:'gps'|'wifi'},
 *   indoor(): object|null, lastCycle(): object|null, subscribe(listener): Function,
 *   runCycle(): Promise<void>, stop(): void}}
 */
export function startWifiFusion({
  scan = () => WifiScan.scan(),
  estimate = estimateWifiPosition,
  floorsFor = async (building) => surveyedFloors(await loadAccessPoints(), building),
  isAvailable = isWifiScanAvailable,
  now = () => Date.now(),
  intervalMs = WIFI_SCAN_INTERVAL_MS,
  threshold = WIFI_CONFIDENCE_THRESHOLD,
  bufferSize = WIFI_SCAN_BUFFER_SIZE,
  maxScanAgeMs = WIFI_SCAN_MAX_AGE_MS,
  maxEstimateAgeMs = WIFI_ESTIMATE_MAX_AGE_MS,
  onCycle = () => {},
} = {}) {
  let stopped = false;
  let busy = false;
  let current = null; // { ...estimate, at } from the last cycle that produced one
  let buffer = []; // [{ at, aps }], oldest first, fresh non-empty scans only
  let acceptedAt = []; // our request times of scans the OS accepted, for scanBudget
  const listeners = new Set();
  // What the last cycle did, for the owner's field-test readout: never read by resolve().
  let last = null;

  const freshEstimate = () => (current && now() - current.at <= maxEstimateAgeMs ? current : null);

  // Every exit path of a cycle goes through here, so none can leave an old estimate in
  // place: a cycle either sets a new one or clears it.
  const finish = (estimateOrNull, outcome, detail = {}) => {
    current = estimateOrNull;
    last = { outcome, at: now(), ...detail };
    onCycle(outcome);
    listeners.forEach((listener) => listener());
  };

  async function runCycle() {
    if (stopped || busy) return;
    busy = true;
    try {
      const requestedAt = now();
      acceptedAt = acceptedAt.filter((t) => requestedAt - t < SCAN_WINDOW_MS);
      if (scanBudget(acceptedAt, requestedAt).retryInMs > 0) return finish(null, 'budget');

      let result;
      try {
        result = await scan();
      } catch (err) {
        // PERMISSION_DENIED, WIFI_OFF, LOCATION_OFF, SCAN_IN_PROGRESS...: no scan, so GPS.
        return finish(null, 'scan-error', { error: err?.code || err?.message || 'unknown' });
      }
      if (stopped) return;
      // Counted unless the plugin says the OS refused it: over-counting only delays a
      // scan, under-counting gets one refused.
      if (result?.accepted !== false) acceptedAt.push(requestedAt);

      const aps = result?.aps;
      if (!Array.isArray(aps) || aps.length === 0) return finish(null, result?.outcome ?? 'no-aps', { apsInScan: 0 });

      buffer.push({ at: requestedAt, aps });
      buffer = buffer.filter((s) => requestedAt - s.at <= maxScanAgeMs).slice(-bufferSize);

      let next;
      try {
        next = await estimate(buffer.map((s) => s.aps));
      } catch (err) {
        // wifi_aps failed to load (offline, signed out). Stage 5 doesn't cache the failure,
        // so the next cycle tries the read again.
        return finish(null, 'estimate-error', { apsInScan: aps.length, error: err?.code || err?.message || 'unknown' });
      }
      if (stopped) return;

      // The floor picker's tabs. Only worth the lookup for an estimate that will be shown,
      // and a failure costs the other tabs, never the estimate itself.
      let floors = [];
      if (indoorReading(next, threshold)) {
        try {
          floors = await floorsFor(next.building);
        } catch {
          floors = [];
        }
        if (stopped) return;
      }
      finish({ ...next, floors, at: now() }, 'estimate', { apsInScan: aps.length, estimate: next });
    } finally {
      busy = false;
    }
  }

  let timer = null;
  if (isAvailable()) {
    runCycle();
    timer = setInterval(runCycle, intervalMs);
  } else {
    last = { outcome: 'unavailable', at: now() };
  }

  return {
    resolve(gps) {
      return choosePosition(gps, freshEstimate(), threshold);
    },
    /**
     * Where the phone is indoors right now, or null. Judged on the same fresh estimate and
     * threshold as resolve(), so a non-null answer always comes with a 'wifi' position.
     * `expiresAt` is when this answer stops being fresh, for a UI with no cycle due sooner.
     */
    indoor() {
      const fresh = freshEstimate();
      const reading = indoorReading(fresh, threshold);
      return reading && { ...reading, expiresAt: fresh.at + maxEstimateAgeMs };
    },
    /**
     * The last cycle, for the owner's field-test readout: { outcome, at, apsInScan?,
     * error?, estimate? (Stage 5's raw result, trusted or not), usedWifi }, or null before
     * the first cycle ends.
     */
    lastCycle() {
      if (!last) return null;
      const usedWifi = Boolean(last.estimate) && choosePosition({ lat: NaN, lng: NaN }, last.estimate, threshold).positionSource === 'wifi';
      return { ...last, usedWifi, threshold };
    },
    /** Calls `listener` after every cycle and on stop(). Returns the unsubscribe. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    runCycle,
    stop() {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      current = null;
      buffer = [];
      listeners.forEach((listener) => listener());
      listeners.clear();
    },
  };
}
