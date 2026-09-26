import { angularDifference, calculateBearing, calculateDistanceMeters } from './geoMath';

// AR Scan's floating tags: which squad members and buildings get a label, and where on
// screen it sits. Pure, so the projection is tested without a camera or a compass.

// A rough stand-in for the phone camera's horizontal field of view. Real phones vary and
// nothing here reads the camera's intrinsics, so this needs tuning on a device.
export const ASSUMED_CAMERA_FOV_DEG = 60;
// Anything further than this is left untagged even when it's straight ahead.
export const MAX_TAG_DISTANCE_METERS = 500;
// Clutter cap: the nearest ones win.
export const MAX_VISIBLE_TAGS = 6;

// Vertical band the tags sit in, as fractions of screen height. A crude horizon: the
// nearest things sit lowest, the furthest highest. Not tilt-compensated (nothing in the
// app reads the phone's pitch yet), so it is only right when the phone is held upright.
export const TAG_BAND_TOP = 0.18;
export const TAG_BAND_BOTTOM = 0.46; // above most of the arrow ring, which sits mid-screen

// Horizontal screen position for a target `angularDiff` degrees clockwise of where the
// phone points, or null when it's outside the view cone. A target exactly on the edge is
// outside (its tag would be cut in half).
export const projectScreenX = (angularDiff, screenWidth, fovDeg = ASSUMED_CAMERA_FOV_DEG) => {
  const half = fovDeg / 2;
  if (!Number.isFinite(angularDiff) || Math.abs(angularDiff) >= half) return null;
  const centerX = screenWidth / 2;
  return centerX + (angularDiff / half) * centerX;
};

// Vertical position from distance alone: 0 m at the band's bottom, maxDistance and
// beyond at its top. The band is TAG_BAND_* unless given (the AR road line uses its own).
export const projectScreenY = (
  distance,
  screenHeight,
  maxDistance = MAX_TAG_DISTANCE_METERS,
  band = { top: TAG_BAND_TOP, bottom: TAG_BAND_BOTTOM },
) => {
  const t = Math.min(Math.max(distance / maxDistance, 0), 1);
  return (band.bottom - t * (band.bottom - band.top)) * screenHeight;
};

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

// Whether roster entry `m` is the member arTarget follows.
const isTargetMember = (target, m) =>
  Boolean(target && (target.memberUid ? m.uid === target.memberUid : target.memberId && m.id === target.memberId));

const sameSpot = (a, b) => a && b && calculateDistanceMeters(a.lat, a.lng, b.lat, b.lng) < 1;

/**
 * Where one real-world point lands on screen, as seen from `origin` facing `heading`:
 * { distance (whole metres), x, y }, or null when it's outside the view cone. Distance 0
 * means standing on it, where no bearing means anything, so that is null too.
 * `maxDistance` and `band` set the vertical placement (see projectScreenY); the tags use
 * the defaults. The one projection for everything AR Scan draws over the camera.
 */
export const projectPoint = ({
  origin,
  heading,
  lat,
  lng,
  screenWidth,
  screenHeight,
  fovDeg = ASSUMED_CAMERA_FOV_DEG,
  maxDistance = MAX_TAG_DISTANCE_METERS,
  band,
}) => {
  const distance = calculateDistanceMeters(origin.lat, origin.lng, lat, lng);
  if (!(distance > 0)) return null;
  const diff = angularDifference(calculateBearing(origin.lat, origin.lng, lat, lng), heading);
  const x = projectScreenX(diff, screenWidth, fovDeg);
  if (x === null) return null;
  return { distance, x, y: projectScreenY(Math.min(distance, maxDistance), screenHeight, maxDistance, band) };
};

/**
 * The tags to draw. `origin` is { lat, lng } (this phone), `heading` the fused heading.
 * `members` are roster entries ({ id, uid, name, hasFix, lat, lng }); `buildings` are
 * SRM_MASTER_DATABASE entries. `target` is AR Scan's one destination (arTarget).
 *
 * Returns { target, ambient }: `target` is the destination's tag when it's in view (no
 * distance cap and outside the MAX_VISIBLE_TAGS count, since its arrow points there
 * anyway), else null. `ambient` holds up to MAX_VISIBLE_TAGS other tags, nearest first,
 * each { key, kind: 'member' | 'building', name, distance, x, y }. The destination never
 * gets an ambient tag as well.
 */
export const selectArTags = ({
  origin,
  heading,
  members = [],
  buildings = [],
  selfUid = null,
  target = null,
  screenWidth,
  screenHeight,
  fovDeg = ASSUMED_CAMERA_FOV_DEG,
  maxDistance = MAX_TAG_DISTANCE_METERS,
  maxTags = MAX_VISIBLE_TAGS,
}) => {
  if (!origin || origin.lat == null || origin.lng == null || !Number.isFinite(heading)) {
    return { target: null, ambient: [] };
  }
  const view = { origin, heading, screenWidth, screenHeight, fovDeg };

  const candidates = [
    ...members
      .filter((m) => m && m.hasFix && m.lat != null && m.lng != null && !(selfUid && m.uid === selfUid))
      .filter((m) => !isTargetMember(target, m))
      .map((m) => ({ key: `member-${m.id}`, kind: 'member', name: m.name || 'SQUAD_NODE', lat: m.lat, lng: m.lng })),
    ...buildings
      .filter((b) => b && b.lat != null && b.lng != null)
      .map((b) => ({ key: `building-${b.id}`, kind: 'building', name: b.name, lat: b.lat, lng: b.lng })),
  ];

  const ambient = [];
  for (const c of candidates) {
    if (target && c.name === target.name && sameSpot(c, target)) continue;
    const p = projectPoint({ ...view, lat: c.lat, lng: c.lng });
    if (!p || p.distance > maxDistance) continue;
    ambient.push({ key: c.key, kind: c.kind, name: c.name, ...p });
  }
  ambient.sort((a, b) => a.distance - b.distance);

  let targetTag = null;
  if (target && target.lat != null && target.lng != null) {
    const p = projectPoint({ ...view, lat: target.lat, lng: target.lng });
    if (p) targetTag = { key: 'target', kind: 'target', name: target.name, ...p };
  }

  return { target: targetTag, ambient: ambient.slice(0, maxTags) };
};
