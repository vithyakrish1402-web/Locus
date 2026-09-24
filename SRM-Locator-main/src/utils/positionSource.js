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
export const WIFI_POSITIONING_ENABLED = false;

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
