// The local metres frame for TECH PARK Floor 7. All the indoor filter and wall maths happens
// here, in metres, never in degrees: x runs along the floor plan's x axis, y along its y axis.
//
// The origin and rotation are the ONLY place the frame is defined. The plan (floor7Plan.js) is
// in its own metres with its origin at the centre of lift lobby A; this frame only says which
// latitude/longitude that origin is shown at. Access points are placed in plan metres and
// converted with the same two numbers, so the position code never depends on them being right.
// They would matter only to put the plan on a real map, which is not done yet.
//
// Flat-earth approximation: over the ~100 m of a floor it differs from true geodesic distance
// by far less than a centimetre, and toGeo(toLocal(p)) returns p to floating-point precision.

/** Reference point for the plan's (0, 0): roughly the middle of the Floor 7 survey points. */
export const FLOOR7_ORIGIN = { lat: 12.82497, lng: 80.04523 };

/**
 * How far the plan's x axis is turned counter-clockwise from true east, in degrees.
 * 0 means x = east and y = north.
 */
export const FLOOR7_ROTATION_DEG = 0;

const toRad = (deg) => (deg * Math.PI) / 180;

/** Metres per degree of latitude / longitude at `latDeg` (WGS84 series expansion). */
function metresPerDegree(latDeg) {
  const phi = toRad(latDeg);
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lng: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi),
  };
}

/** lat/lng (degrees) -> { x, y } metres in the Floor 7 frame. */
export function toLocal(lat, lng, origin = FLOOR7_ORIGIN, rotationDeg = FLOOR7_ROTATION_DEG) {
  const per = metresPerDegree(origin.lat);
  const east = (lng - origin.lng) * per.lng;
  const north = (lat - origin.lat) * per.lat;
  const t = toRad(rotationDeg);
  return { x: east * Math.cos(t) + north * Math.sin(t), y: -east * Math.sin(t) + north * Math.cos(t) };
}

/** { x, y } metres in the Floor 7 frame -> { lat, lng } degrees. The exact inverse of toLocal. */
export function toGeo(x, y, origin = FLOOR7_ORIGIN, rotationDeg = FLOOR7_ROTATION_DEG) {
  const per = metresPerDegree(origin.lat);
  const t = toRad(rotationDeg);
  const east = x * Math.cos(t) - y * Math.sin(t);
  const north = x * Math.sin(t) + y * Math.cos(t);
  return { lat: origin.lat + north / per.lat, lng: origin.lng + east / per.lng };
}
