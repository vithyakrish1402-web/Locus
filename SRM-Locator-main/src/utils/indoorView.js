// WiFi Arc Stage 7: the pure pieces of the indoor map UI - labels, the confidence halo, and
// which squadmates a floor tab dims. No React and no WiFi code, so it is safe for App.jsx
// and both map engines to import statically; everything that uses it is gated on
// WIFI_POSITIONING_ENABLED / SHOW_INDOOR_POSITION_TO_SQUAD at the call site.

import { WIFI_CONFIDENCE_THRESHOLD } from './positionSource.js';
import { SRM_MASTER_DATABASE } from '../srmDatabase.js';

/** Halo radius at full confidence: tight, because the estimate is as sure as it gets. */
export const MIN_HALO_PX = 24;
/** Halo radius at the threshold: the widest and softest a shown estimate gets. */
export const MAX_HALO_PX = 60;
/** How long you can browse a floor you're not on before "Return to F{n}" slides in. */
export const RETURN_CHIP_DELAY_MS = 2000;

/** Survey floor number -> tab label. Floor 0 is the ground floor, "G". */
export function floorLabel(floor) {
  return floor === 0 ? 'G' : `F${floor}`;
}

/**
 * The self marker's halo for a confidence. Stage 5 has no spread in metres, so this shows
 * how sure the estimate is, not how far off it may be. Only estimates at or above the
 * threshold are ever shown, so that range is what gets stretched: threshold -> MAX_HALO_PX
 * with a soft edge, 1 -> MIN_HALO_PX with a crisper one.
 *
 * @returns {{radius:number, solidStop:number}} solidStop: how far out (0..1) the halo stays
 *   at full strength before fading
 */
export function haloFor(confidence, threshold = WIFI_CONFIDENCE_THRESHOLD) {
  const c = Number.isFinite(confidence) ? confidence : threshold;
  const t = Math.min(1, Math.max(0, (c - threshold) / (1 - threshold)));
  return {
    radius: Math.round(MAX_HALO_PX + (MIN_HALO_PX - MAX_HALO_PX) * t),
    solidStop: 0.15 + 0.45 * t,
  };
}

/**
 * The building whose traced footprint contains `point`, or null. This is what puts a floor
 * picker on the map for a building the WiFi survey has never covered: your GPS fix alone
 * says which building you're in, even when nothing says which floor. Buildings with no
 * footprint in the database can't be told apart from the ground around them, so they never
 * match. Ray casting over [lat, lng] pairs, which is exact enough at a building's scale.
 *
 * @param {{lat:number, lng:number}|null} point
 * @param {Array<{name:string, footprint?:number[][]}>} [buildings]
 */
export function buildingAt(point, buildings = SRM_MASTER_DATABASE) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) return null;
  return (
    buildings.find(({ footprint }) => {
      if (!Array.isArray(footprint) || footprint.length < 3) return false;
      let inside = false;
      for (let i = 0, j = footprint.length - 1; i < footprint.length; j = i++) {
        const [latI, lngI] = footprint[i];
        const [latJ, lngJ] = footprint[j];
        if (latI > point.lat !== latJ > point.lat && point.lng < ((lngJ - lngI) * (point.lat - latI)) / (latJ - latI) + lngI) {
          inside = !inside;
        }
      }
      return inside;
    }) ?? null
  );
}

/** Whether a roster member reported an indoor floor in their latest telemetry. */
export function hasIndoorFloor(member) {
  return typeof member?.building === 'string' && Number.isInteger(member?.floor);
}

/** The map pill for a squadmate indoors, e.g. "ALEX · F2", or null outdoors. */
export function memberFloorTag(member) {
  if (!hasIndoorFloor(member)) return null;
  return `${(member.name || 'SQUAD NODE').toUpperCase()} · ${floorLabel(member.floor)}`;
}

/**
 * Whether a squadmate is drawn dimmed: they are in the building you're looking at, on a
 * floor other than the tab you have open. Dimmed, never hidden - squad positions are not
 * something a map view gets to make disappear. Members outdoors, in another building, or
 * seen while you have no floor picker or no tab open are never dimmed.
 *
 * @param {object} member a roster entry
 * @param {{building:string, viewedFloor:number}|null} view from useIndoorView
 */
export function isOnOtherFloor(member, view) {
  return (
    Boolean(view) &&
    Number.isInteger(view.viewedFloor) &&
    hasIndoorFloor(member) &&
    member.building === view.building &&
    member.floor !== view.viewedFloor
  );
}
