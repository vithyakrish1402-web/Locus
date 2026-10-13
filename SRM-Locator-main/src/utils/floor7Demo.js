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

import { floor7Plan } from './floor7Plan.js';
import floor7Aps from '../data/floor7Aps.json';
import { toGeo, toLocal } from './floor7Frame.js';
import { createPositionFilter } from './positionFilter.js';
import { WIFI_CONFIDENCE_THRESHOLD } from './positionSource.js';
import { setLocalAccessPoints } from './wifiPositioning.js';
import { WIFI_ESTIMATE_MAX_AGE_MS } from './wifiFusion.js';

export const DEMO_BUILDING = 'TECH PARK';
export const DEMO_FLOOR = 7;

/** Uncertainty (m, one sigma) at which the halo has shrunk to nothing, i.e. confidence 0. */
export const HALO_FULL_UNCERTAINTY_M = 20;

/** How many steps the debug overlay remembers. */
export const TRAIL_LENGTH = 60;

/**
 * The plan as the filter and the overlay use it: { walkable: {x,y}[][], walls: {a,b}[], spots }.
 * Walkable space is the corridors and lift lobbies only, so a point inside a room is snapped
 * out to the corridor in front of it. Straight from floor7Plan.js: one plan, one scale.
 */
export const floor7Geometry = {
  walkable: floor7Plan.walkable,
  walls: floor7Plan.walls,
  spots: floor7Plan.spots,
};

/** floor7Aps.json -> the table wifiPositioning.js expects, keyed by lowercase BSSID. */
export function floor7AccessPointTable(doc = floor7Aps) {
  const table = new Map();
  for (const radio of doc.radios) {
    const { lat, lng } = toGeo(radio.x, radio.y);
    for (const { bssid } of radio.bssids) {
      table.set(bssid.toLowerCase(), { lat, lng, building: DEMO_BUILDING, floor: DEMO_FLOOR, ambiguousFloor: false });
    }
  }
  return table;
}

/** Filter uncertainty -> 0..1 for the existing confidence halo (smaller circle = more sure). */
export const confidenceFromUncertainty = (uncertaintyM) =>
  Math.max(0, Math.min(1, 1 - uncertaintyM / HALO_FULL_UNCERTAINTY_M));

// ---------------------------------------------------------------- the debug trail

let trail = [];
const listeners = new Set();

/**
 * What the overlay draws: newest last. Each: { at, raw:{x,y}, snapped:{x,y}, filtered:{x,y},
 * status, uncertaintyM }. `snapped` is the raw estimate moved onto the nearest corridor
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
export function createFloor7Tracker({ staleMs = WIFI_ESTIMATE_MAX_AGE_MS } = {}) {
  const filter = createPositionFilter({ staleMs, walls: floor7Geometry.walls, walkable: floor7Geometry.walkable });

  return {
    /**
     * A Floor 7 estimate with its position replaced by the filtered one. The confidence is
     * rebuilt from the filter's uncertainty (so the halo shows how sure the filter is) and is
     * never below the WiFi threshold: while the filter holds a Floor 7 position, GPS cannot
     * take over from it indoors. Anything that is not a Floor 7 estimate is returned as is.
     */
    apply(estimate, atMs) {
      if (estimate?.building !== DEMO_BUILDING || estimate.floor !== DEMO_FLOOR) return estimate;
      if (!Number.isFinite(estimate.lat) || !Number.isFinite(estimate.lng)) return estimate;
      const raw = toLocal(estimate.lat, estimate.lng);
      const { x: sx, y: sy } = floor7Plan.snapToCorridor(raw.x, raw.y);
      const status = filter.update({ ...raw, confidence: estimate.confidence }, atMs);
      const filtered = filter.position;
      const uncertaintyM = filter.uncertaintyM;
      trail = [...trail, { at: atMs, raw, snapped: { x: sx, y: sy }, filtered, status, uncertaintyM }].slice(-TRAIL_LENGTH);
      listeners.forEach((l) => l());
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
  return { tracker: createFloor7Tracker() };
}
