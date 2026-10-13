// Floor 7 radios (floor7Aps.json, plan metres as drawn) -> the table wifiPositioning.js
// expects, keyed by lowercase BSSID. No imports beyond the frame, so the app's demo and the
// leave-one-scan-out replay (a Node script) build the very same table.
import { toGeo } from './floor7Frame.js';

export const DEMO_BUILDING = 'TECH PARK';
export const DEMO_FLOOR = 7;

/** `scale` is PLAN_SCALE: the file's metres times it are real metres, as for the plan itself. */
export function accessPointTable(radios, scale) {
  const table = new Map();
  for (const radio of radios) {
    const { lat, lng } = toGeo(radio.x * scale, radio.y * scale);
    for (const { bssid } of radio.bssids) {
      table.set(bssid.toLowerCase(), { lat, lng, building: DEMO_BUILDING, floor: DEMO_FLOOR, ambiguousFloor: false });
    }
  }
  return table;
}
