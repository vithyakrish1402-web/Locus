import { angularDifference, calculateBearing, calculateDistanceMeters } from './geoMath';
import { haversineMeters } from './walkingRoute';

// AR Scan's older screen projection, by bearing and distance alone (no tilt), which the
// Stage 3 ribbon still uses by default (arRoadLine.js), plus who AR Scan is tracking.
// The tags themselves are placed by the Landmark Anchor Engine (landmarkAnchorEngine.js).

// The default horizontal field of view, for callers that don't pass the real one. AR Scan
// itself passes effectiveHorizontalFov's (landmarkAnchorEngine.js), from the live video.
export const ASSUMED_CAMERA_FOV_DEG = 60;
// The far end of the distance band below.
export const MAX_TAG_DISTANCE_METERS = 500;

// A vertical band by distance alone, as fractions of screen height: a crude horizon, the
// nearest things lowest, the furthest highest. Not tilt-compensated. The Stage 3 ribbon's
// default curve is fitted to meet it (roadScreenYFor); AR Scan itself now draws the
// ribbon through the real camera instead (buildRoadRibbon's projectGround).
export const TAG_BAND_TOP = 0.18;
export const TAG_BAND_BOTTOM = 0.46; // above most of the arrow ring, which sits mid-screen

const rad = (deg) => (deg * Math.PI) / 180;

// Horizontal screen position for a target `angularDiff` degrees clockwise of where the
// phone points, or null when it's outside the view cone. A pinhole camera's mapping
// (by the tangent, as the 3D road's camera does it), so tags agree with what the lens
// shows toward the edges. A target exactly on the edge is outside.
export const projectScreenX = (angularDiff, screenWidth, fovDeg = ASSUMED_CAMERA_FOV_DEG) => {
  const half = fovDeg / 2;
  if (!Number.isFinite(angularDiff) || Math.abs(angularDiff) >= half) return null;
  const centerX = screenWidth / 2;
  return centerX + (Math.tan(rad(angularDiff)) / Math.tan(rad(half))) * centerX;
};

// The floating tags' vertical position, from distance alone (see TAG_BAND_*): 0 m at
// the band's bottom, maxDistance and beyond at its top.
export const projectScreenY = (distance, screenHeight, maxDistance = MAX_TAG_DISTANCE_METERS) => {
  const t = Math.min(Math.max(distance / maxDistance, 0), 1);
  return (TAG_BAND_BOTTOM - t * (TAG_BAND_BOTTOM - TAG_BAND_TOP)) * screenHeight;
};

// projectScreenY as a fraction of screen height: projectPoint's default vertical curve.
const tagScreenYFor = (distance) => projectScreenY(distance, 1);

// arTarget for a squad member, remembering who it is so followArTarget can keep it on them.
export const arTargetForMember = (m, fallbackName = 'SQUAD_NODE') => ({
  lat: m.lat,
  lng: m.lng,
  name: m.name || fallbackName,
  ...(m.uid ? { memberUid: m.uid } : { memberId: m.id }),
});

/**
 * AR Scan's destination, kept on a squad member as they move. When arTarget was aimed at
 * a member it carries memberUid (stable across reconnects) or, for a member with no uid,
 * memberId (their socket id). Returns arTarget moved to that member's live position, or
 * arTarget itself (same object, so a state update bails out) when there is nothing newer:
 * not a member, or the member has no fix right now or has left, in which case their last
 * known position stands.
 */
export const followArTarget = (arTarget, members) => {
  if (!arTarget || (!arTarget.memberUid && !arTarget.memberId) || !Array.isArray(members)) return arTarget;
  const live = members.find((m) =>
    arTarget.memberUid ? m.uid === arTarget.memberUid : m.id === arTarget.memberId);
  if (!live || !live.hasFix || live.lat == null || live.lng == null) return arTarget;
  if (live.lat === arTarget.lat && live.lng === arTarget.lng) return arTarget;
  return { ...arTarget, lat: live.lat, lng: live.lng };
};

/**
 * Where one real-world point lands on screen, as seen from `origin` facing `heading`:
 * { distance (whole metres), x, y }, or null when it's outside the view cone. Distance 0
 * means standing on it, where no bearing means anything, so that is null too.
 * `screenYFor(metres)` gives the height as a fraction of the screen: the tags' band by
 * default, the road line's perspective curve for the road (see arRoadLine.js). It gets the
 * exact distance, not the whole metres, so a steep curve doesn't step as you walk.
 * The one projection for everything AR Scan draws over the camera.
 */
export const projectPoint = ({
  origin,
  heading,
  lat,
  lng,
  screenWidth,
  screenHeight,
  fovDeg = ASSUMED_CAMERA_FOV_DEG,
  screenYFor = tagScreenYFor,
}) => {
  const distance = calculateDistanceMeters(origin.lat, origin.lng, lat, lng);
  if (!(distance > 0)) return null;
  const diff = angularDifference(calculateBearing(origin.lat, origin.lng, lat, lng), heading);
  const x = projectScreenX(diff, screenWidth, fovDeg);
  if (x === null) return null;
  return { distance, x, y: screenYFor(haversineMeters(origin, { lat, lng })) * screenHeight };
};
