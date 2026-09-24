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
import { estimateWifiPosition } from './wifiPositioning.js';

// ---------------------------------------------------------------- tuning (v1 assumptions)

/**
 * Minimum Stage 5 confidence for WiFi to replace GPS. A guess, not a measurement: no
 * confidence has been observed against real TECH PARK scans yet. Tune it once they have.
 * With Stage 5's formula, 0.6 needs at least 3 matched APs voting for one (building, floor).
 */
export const WIFI_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Time between scans. Note that 30 s is exactly the OS budget (4 per 2 minutes), not
 * under it: every scan is spent. The budget check in runCycle skips a cycle rather than
 * let one be refused, so this is safe, but anything faster only produces skipped cycles.
 */
export const WIFI_SCAN_INTERVAL_MS = 30_000;

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

// ---------------------------------------------------------------- the loop

/**
 * Starts scanning and returns the controller the emit sites read from. Everything it
 * touches is injectable so tests can drive it without a phone or Firestore.
 *
 * @returns {{resolve(gps): {lat:number, lng:number, positionSource:'gps'|'wifi'},
 *   runCycle(): Promise<void>, stop(): void}}
 */
export function startWifiFusion({
  scan = () => WifiScan.scan(),
  estimate = estimateWifiPosition,
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

  // Every exit path of a cycle goes through here, so none can leave an old estimate in
  // place: a cycle either sets a new one or clears it.
  const finish = (estimateOrNull, outcome) => {
    current = estimateOrNull;
    onCycle(outcome);
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
      } catch {
        // PERMISSION_DENIED, WIFI_OFF, LOCATION_OFF, SCAN_IN_PROGRESS...: no scan, so GPS.
        return finish(null, 'scan-error');
      }
      if (stopped) return;
      // Counted unless the plugin says the OS refused it: over-counting only delays a
      // scan, under-counting gets one refused.
      if (result?.accepted !== false) acceptedAt.push(requestedAt);

      const aps = result?.aps;
      if (!Array.isArray(aps) || aps.length === 0) return finish(null, result?.outcome ?? 'no-aps');

      buffer.push({ at: requestedAt, aps });
      buffer = buffer.filter((s) => requestedAt - s.at <= maxScanAgeMs).slice(-bufferSize);

      let next;
      try {
        next = await estimate(buffer.map((s) => s.aps));
      } catch {
        // wifi_aps failed to load (offline, signed out). Stage 5 doesn't cache the failure,
        // so the next cycle tries the read again.
        return finish(null, 'estimate-error');
      }
      if (stopped) return;
      finish({ ...next, at: now() }, 'estimate');
    } finally {
      busy = false;
    }
  }

  let timer = null;
  if (isAvailable()) {
    runCycle();
    timer = setInterval(runCycle, intervalMs);
  }

  return {
    resolve(gps) {
      const fresh = current && now() - current.at <= maxEstimateAgeMs ? current : null;
      return choosePosition(gps, fresh, threshold);
    },
    runCycle,
    stop() {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      current = null;
      buffer = [];
    },
  };
}
