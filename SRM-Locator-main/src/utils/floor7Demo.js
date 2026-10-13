// The TECH PARK Floor 7 demo: steadier, believable indoor positions for the Dean demo.
// Loaded only by useWifiFusion, and only in the separate "LOCUS Test" build (Vite mode
// 'sidetest', where WIFI_POSITIONING_ENABLED is on). Nothing here is in any other build.
//
// It does two things:
//   - swaps the live wifi_aps table for the Floor 7 one bundled in src/data/floor7Aps.json
//     (placed at the survey spots of the Floor 7 plan, floor7Plan.js), so the Firestore table
//     is never read;
//   - gives startWifiFusion a tracker that runs every Floor 7 estimate through the position
//     filter (positionFilter.js) before the map and `update-location` see it.
//
// Floor 7 is fixed for the demo: the bundled table only holds Floor 7 access points, so the
// floor vote can only say Floor 7. Estimates for anything else pass through untouched.

import { DEMO_BUILDING, DEMO_FLOOR, accessPointTable } from './floor7ApTable.js';
import { PLAN_SCALE, floor7Plan } from './floor7Plan.js';
import floor7Aps from '../data/floor7Aps.json';
import { toGeo, toLocal } from './floor7Frame.js';
import { createPositionFilter } from './positionFilter.js';
import { WIFI_CONFIDENCE_THRESHOLD } from './positionSource.js';
import { setLocalAccessPoints } from './wifiPositioning.js';
import { WIFI_ESTIMATE_MAX_AGE_MS } from './wifiFusion.js';
import { recorder } from './floor7Recorder.js';

export { DEMO_BUILDING, DEMO_FLOOR };

/** Uncertainty (m, one sigma) at which the halo has shrunk to nothing, i.e. confidence 0. */
export const HALO_FULL_UNCERTAINTY_M = 20;

/** How many steps the debug overlay remembers. */
export const TRAIL_LENGTH = 60;

/** The surveyed spots of the plan, by name (Room 701, Lift lobby B near 706, ...): plan metres. */
export const floor7Spots = floor7Plan.spots;

/** floor7Aps.json -> the table wifiPositioning.js expects (see floor7ApTable.js). */
export const floor7AccessPointTable = (doc = floor7Aps, scale = PLAN_SCALE) => accessPointTable(doc.radios, scale);

const round2 = (v) => Math.round(v * 100) / 100;

/** Filter uncertainty -> 0..1 for the existing confidence halo (smaller circle = more sure). */
export const confidenceFromUncertainty = (uncertaintyM) =>
  Math.max(0, Math.min(1, 1 - uncertaintyM / HALO_FULL_UNCERTAINTY_M));

// ---------------------------------------------------------------- the debug trail

let trail = [];
const listeners = new Set();

/** Prefixes the one console line per estimate that scripts/floor7-phone-walk.mjs reads from adb logcat. */
export const FIX_LOG_MARKER = '[F7]';

/**
 * What the overlay draws: newest last. Each: { at, raw:{x,y}, snapped:{x,y}, filtered:{x,y}|null,
 * status, uncertaintyM }. `filtered` is null while the filter is still confirming a start. `snapped` is the raw estimate moved onto the nearest corridor
 * centreline: shown for checking, the filter does not use it yet.
 */
export const getTrail = () => trail;
export function subscribeTrail(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------- the tracker

/**
 * @param {object} [options]
 * @param {number} [options.staleMs] defaults to the WiFi staleness constant
 * @returns {{apply(estimate: object, atMs: number): object, reset(): void}}
 */
/**
 * Hands the walk recorder what the tracker just computed (it ignores it unless a recording is
 * running). Observes only: it can neither change a position nor stop the pipeline.
 */
function observe(estimate, { atMs, raw, snapped, filtered, status, uncertaintyM, before, scans }) {
  if (!recorder.recording) return;
  try {
    const corridor = floor7Plan.snapToCorridor(raw.x, raw.y);
    recorder.recordEstimate({
      at: atMs, raw, filtered, status, unc: uncertaintyM, scans,
      snapped: { x: snapped.x, y: snapped.y, edge: corridor.edge, offset: corridor.offset },
      walkFromLastM: before ? floor7Plan.walkingDistance(before, snapped) : null,
      confidence: estimate.confidence, matched: estimate.matchedApCount, total: estimate.totalApsSeen,
    });
  } catch (e) {
    console.warn('[F7 recorder]', e?.message);
  }
}

export function createFloor7Tracker({ staleMs = WIFI_ESTIMATE_MAX_AGE_MS } = {}) {
  const filter = createPositionFilter({ staleMs, plan: floor7Plan });

  return {
    /**
     * A Floor 7 estimate with its position replaced by the filtered one. The confidence is
     * rebuilt from the filter's uncertainty (so the halo shows how sure the filter is) and is
     * never below the WiFi threshold: while the filter holds a Floor 7 position, GPS cannot
     * take over from it indoors. While the filter has no confirmed position yet (a start
     * waiting for a second estimate) the estimate carries no position and confidence 0.
     * Anything that is not a Floor 7 estimate is returned as is.
     * `scans` (the buffer the estimate was made from) is only handed on to the walk recorder.
     */
    apply(estimate, atMs, scans) {
      if (estimate?.building !== DEMO_BUILDING || estimate.floor !== DEMO_FLOOR) return estimate;
      if (!Number.isFinite(estimate.lat) || !Number.isFinite(estimate.lng)) return estimate;
      const raw = toLocal(estimate.lat, estimate.lng);
      const before = recorder.recording ? filter.position : null; // for the recorder only
      const status = filter.update({ ...raw, confidence: estimate.confidence }, atMs);
      const filtered = filter.position;
      const snapped = filter.lastSnapped;
      const uncertaintyM = filter.uncertaintyM;
      trail = [...trail, { at: atMs, raw, snapped, filtered, status, uncertaintyM }].slice(-TRAIL_LENGTH);
      listeners.forEach((l) => l());
      // One line per estimate, for the phone walk (adb logcat -s Capacitor/Console): what was
      // shown, in plan metres, and why. Test build only: nothing else imports this file.
      console.info(FIX_LOG_MARKER, JSON.stringify({
        at: atMs, status, x: filtered && round2(filtered.x), y: filtered && round2(filtered.y),
        rawX: round2(raw.x), rawY: round2(raw.y), snapX: round2(snapped.x), snapY: round2(snapped.y), unc: round2(uncertaintyM),
      }));
      observe(estimate, { atMs, raw, snapped, filtered, status, uncertaintyM, before, scans });
      if (!filtered) {
        // No confirmed position yet (a start waiting for a second estimate that agrees): show
        // nothing, so the map stays on GPS rather than on one stray reading.
        return { ...estimate, lat: null, lng: null, confidence: 0, rawConfidence: estimate.confidence, filterStatus: status, uncertaintyM: 0 };
      }
      const geo = toGeo(filtered.x, filtered.y);
      return {
        ...estimate,
        lat: geo.lat,
        lng: geo.lng,
        confidence: Math.max(WIFI_CONFIDENCE_THRESHOLD, confidenceFromUncertainty(uncertaintyM)),
        rawConfidence: estimate.confidence,
        filterStatus: status,
        uncertaintyM,
      };
    },
    reset() {
      filter.reset();
      trail = [];
      listeners.forEach((l) => l());
    },
  };
}

/** What useWifiFusion passes to startWifiFusion: the bundled AP table is installed here. */
export function floor7FusionOptions() {
  setLocalAccessPoints(floor7AccessPointTable());
  return { tracker: createFloor7Tracker(), onCycle: (outcome) => recorder.recordCycle(outcome) };
}
