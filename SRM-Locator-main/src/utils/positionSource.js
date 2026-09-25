// WiFi Arc Stage 6: the on/off switch for GPS/WiFi fusion, and the one helper every
// `update-location` emit goes through. Deliberately tiny and dependency-free: App.jsx
// imports it statically, and nothing WiFi-related may come along with it.
//
// Off, useWifiFusion never loads src/utils/wifiFusion.js (the flag is a compile-time
// constant, so the build drops the dynamic import and the WiFi modules altogether), no
// scan is ever requested, and every update reports positionSource 'gps'.
//
// Keep this false until the TECH PARK device check has shown Stage 5's estimates are good.
// Turning it off again after a bad release needs only this line and a JS-only bundle.
export const WIFI_POSITIONING_ENABLED = true;

/**
 * Minimum Stage 5 confidence for WiFi to replace GPS. A guess, not a measurement: no
 * confidence has been observed against real TECH PARK scans yet. Tune it once they have.
 * With Stage 5's formula, 0.6 needs at least 3 matched APs voting for one (building, floor).
 * (Here rather than in wifiFusion.js so the map UI can read it without loading fusion.)
 */
export const WIFI_CONFIDENCE_THRESHOLD = 0.6;

// WiFi Arc Stage 7: whether this phone tells its squad which building and floor it is on.
// Independent of WIFI_POSITIONING_ENABLED: that one shows your own indoor position to you;
// this one adds `building` + `floor` to `update-location` and shows squadmates' floors.
// Off, the payload is exactly Stage 6's and nothing about other members' floors renders.
// Flipping it is the whole change - no other line needs to move.
export const SHOW_INDOOR_POSITION_TO_SQUAD = false;

/**
 * The position to put in an `update-location` payload.
 *
 * @param {{lat:number, lng:number}} gps the smoothed GPS fix the app has today
 * @param {{resolve: Function}|null} fusion a running controller from wifiFusion.js, or null
 * @returns {{lat:number, lng:number, positionSource:'gps'|'wifi'}}
 */
export function resolvePosition(gps, fusion) {
  return fusion ? fusion.resolve(gps) : { lat: gps.lat, lng: gps.lng, positionSource: 'gps' };
}

/**
 * Stage 7: `position` plus `building` and `floor`, when it is a WiFi position with a valid
 * indoor reading behind it. Otherwise `position` untouched: the keys are left out entirely,
 * never sent as null, so older clients see the payload they always have, and the server
 * (which stores each update whole) forgets a member's floor on the first update without one.
 *
 * Called only under SHOW_INDOOR_POSITION_TO_SQUAD (see useWifiFusion), as a separate
 * function so that a build with the flag off leaves it out altogether.
 *
 * @param {{lat:number, lng:number, positionSource:'gps'|'wifi'}} position from resolvePosition
 * @param {{indoor?: Function}|null} fusion
 */
export function withIndoorFields(position, fusion) {
  if (position.positionSource !== 'wifi') return position;
  const indoor = fusion?.indoor?.();
  return indoor ? { ...position, building: indoor.building, floor: indoor.floor } : position;
}
