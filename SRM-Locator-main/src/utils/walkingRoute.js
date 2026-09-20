// Shared constants + helpers for the live waypoint navigation route
// (useWalkingRoute.js) — recompute thresholds, distance math, and text
// formatting kept in one place so both the throttling logic and the
// straight-line fallback agree on units/wording.

// Recompute triggers, per the task spec's given ranges — flag if these don't
// match real-world usage, they're not measured against actual walking speed
// variance or GPS jitter on campus.
export const DRIFT_THRESHOLD_M = 18;       // re-route once drifted this far off the last computed route
export const RECOMPUTE_INTERVAL_MS = 20000; // otherwise re-route at least this often
export const WALKING_SPEED_MPS = 1.4;      // ~5 km/h, used only for the straight-line fallback's ETA estimate

export const haversineMeters = (a, b) => {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const phi1 = a.lat * rad, phi2 = b.lat * rad;
  const deltaPhi = (b.lat - a.lat) * rad;
  const deltaLambda = (b.lng - a.lng) * rad;
  const x = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

// Matches the existing ACTIVE_WAYPOINT_TRACKING panel's formatting exactly
// (see App.jsx's pre-existing calculateActualRoute) so a route computed here
// reads identically to the haversine number it's replacing.
export const formatDistanceMeters = (meters) =>
  meters > 1000 ? `${(meters / 1000).toFixed(2)} KM` : `${Math.round(meters)} M`;

export const formatDurationMinutes = (minutes) =>
  `${minutes} MIN${minutes === 1 ? '' : 'S'}`;

// The always-available "best effort" line when no real route is cached —
// straight geometry between the two points, so something renders even before
// the first successful fetch or after one fails.
export const buildStraightLineRoute = (from, to) => {
  const meters = haversineMeters(from, to);
  const minutes = Math.max(1, Math.round(meters / WALKING_SPEED_MPS / 60));
  return {
    path: [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }],
    distance: { text: formatDistanceMeters(meters) },
    duration: { text: formatDurationMinutes(minutes) },
    isRealRoute: false,
  };
};
