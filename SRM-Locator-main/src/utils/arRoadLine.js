import { projectPoint, projectScreenY, ASSUMED_CAMERA_FOV_DEG } from './arTags';
import { DRIFT_THRESHOLD_M, haversineMeters } from './walkingRoute';

// AR Scan's road line: the walking route to the squad's Rally Point, drawn over the
// camera as a red ribbon on the ground that shortens as it is walked. Pure, so it is
// tested without a camera or a compass. Placement uses projectPoint, the same projection
// as the floating tags.

// How far ahead along the route the ribbon is drawn. Further than this, a flat line
// cuts through buildings and stops looking like a path.
export const ROAD_LINE_MAX_DISTANCE_METERS = 150;
// Ribbon width at your feet, narrowing to the far width at the draw limit. Rough, to be
// tuned on a phone.
export const ROAD_LINE_NEAR_WIDTH_PX = 60;
export const ROAD_LINE_FAR_WIDTH_PX = 8;
// The route is resampled this often, so the draw limit and the edge of the view cut it
// where they fall rather than at the nearest routing vertex (those can be 100 m apart).
export const ROAD_LINE_STEP_METERS = 5;
// GPS puts you a few metres off the route, so its start is beside you, outside the
// camera's cone. Out-of-view points this far along the route are skipped as underfoot.
// At DRIFT_THRESHOLD_M off the route (the most useWalkingRoute tolerates before
// re-routing) a 60 deg cone first reaches it about 1.7x that far along; 2x covers it.
export const ROAD_LINE_UNDERFOOT_ALONG_M = 2 * DRIFT_THRESHOLD_M;
// The road line's vertical curve, as fractions of screen height. Ground seen through a
// camera is a perspective curve, height ~ 1 / distance: the first metres spread down the
// screen and the far ones bunch toward the horizon. The near end sits at ROAD_LINE_BOTTOM,
// just above AR Scan's TARGET_LOCK panel (its top is ~0.88 of a 891 px tall screen, and
// higher on shorter ones, where it would hide the first metres). ROAD_LINE_D0_METERS sets
// how fast the curve rises: at that distance the road is halfway to the horizon. The
// horizon is derived so the road's far limit meets the height a floating tag that far
// away sits at. The destination's own tag uses this curve too while a road is drawn
// (selectArTags' targetScreenYFor), so the road always reaches it.
export const ROAD_LINE_BOTTOM = 0.84;
export const ROAD_LINE_D0_METERS = 15;
const farShare = ROAD_LINE_D0_METERS / (ROAD_LINE_MAX_DISTANCE_METERS + ROAD_LINE_D0_METERS);
export const ROAD_LINE_HORIZON =
  (projectScreenY(ROAD_LINE_MAX_DISTANCE_METERS, 1) - ROAD_LINE_BOTTOM * farShare) / (1 - farShare);

// Height of a point on the road `distance` metres away, as a fraction of screen height.
export const roadScreenYFor = (distance) =>
  ROAD_LINE_HORIZON + (ROAD_LINE_BOTTOM - ROAD_LINE_HORIZON) * (ROAD_LINE_D0_METERS / (Math.max(distance, 0) + ROAD_LINE_D0_METERS));

/**
 * The route to draw for this AR Scan session, or null. Only when AR Scan is on the
 * squad's active Rally Point (the AR TRACK button copies its coordinates) and a real
 * routed path exists: never for a squad member (they move, so there is no fixed route),
 * the SRM_HQ default (nothing is routed to it), or the straight-line placeholder
 * useWalkingRoute returns before a route arrives (a straight ribbon through buildings).
 */
export const arRoutePathFor = (arTarget, activeWaypoint, walkingRoute) => {
  if (!arTarget || !activeWaypoint || !walkingRoute) return null;
  if (arTarget.memberUid || arTarget.memberId) return null;
  if (arTarget.lat !== activeWaypoint.lat || arTarget.lng !== activeWaypoint.lng) return null;
  if (!walkingRoute.isRealRoute || !Array.isArray(walkingRoute.path) || walkingRoute.path.length < 2) return null;
  return walkingRoute.path;
};

// Metres east (x) and north (y) of `origin`. Flat, which is plenty over a route's length.
const toLocal = (origin, p) => {
  const R = 6371e3;
  const rad = Math.PI / 180;
  return {
    x: (p.lng - origin.lng) * rad * R * Math.cos(origin.lat * rad),
    y: (p.lat - origin.lat) * rad * R,
  };
};

const isPoint = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

/**
 * What is left of `path` from `position`: the nearest point on the route (snapped onto
 * the nearest segment, not just the nearest vertex), then every vertex after it. Recomputed
 * from scratch each time, so a re-fetched route needs no bookkeeping. Known limit: a route
 * that doubles back close to itself can snap to its later leg.
 */
export const remainingPath = (path, position) => {
  if (!Array.isArray(path) || !isPoint(position)) return [];
  const pts = path.filter(isPoint);
  if (pts.length < 2) return [];
  let best = { d2: Infinity, index: 0, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = toLocal(position, pts[i]);
    const b = toLocal(position, pts[i + 1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(Math.max(-(a.x * dx + a.y * dy) / len2, 0), 1) : 0;
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d2 = px * px + py * py;
    if (d2 < best.d2) best = { d2, index: i, t };
  }
  const a = pts[best.index];
  const b = pts[best.index + 1];
  const snapped = { lat: a.lat + best.t * (b.lat - a.lat), lng: a.lng + best.t * (b.lng - a.lng) };
  return [snapped, ...pts.slice(best.index + 1)];
};

/**
 * `path` resampled every `step` metres along its length, stopping at `maxAlong` metres
 * (the last sample falls exactly there) or at the path's end. Each sample carries
 * `along`, its distance along the path from the start.
 */
export const resamplePath = (path, maxAlong = ROAD_LINE_MAX_DISTANCE_METERS, step = ROAD_LINE_STEP_METERS) => {
  if (!Array.isArray(path) || path.length === 0) return [];
  const out = [{ ...path[0], along: 0 }];
  let along = 0;
  let nextAt = step;
  for (let i = 0; i < path.length - 1 && along < maxAlong; i++) {
    const a = path[i];
    const b = path[i + 1];
    const len = haversineMeters(a, b);
    if (len === 0) continue;
    const segEnd = along + len;
    while (nextAt < segEnd && nextAt < maxAlong) {
      const t = (nextAt - along) / len;
      out.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), along: nextAt });
      nextAt += step;
    }
    if (segEnd >= maxAlong) {
      const t = (maxAlong - along) / len;
      out.push({ lat: a.lat + t * (b.lat - a.lat), lng: a.lng + t * (b.lng - a.lng), along: maxAlong });
      along = maxAlong;
      break;
    }
    along = segEnd;
    out.push({ lat: b.lat, lng: b.lng, along });
    nextAt = along + step;
  }
  return out;
};

const widthAt = (distance) => {
  const t = Math.min(Math.max(distance / ROAD_LINE_MAX_DISTANCE_METERS, 0), 1);
  return ROAD_LINE_NEAR_WIDTH_PX - t * (ROAD_LINE_NEAR_WIDTH_PX - ROAD_LINE_FAR_WIDTH_PX);
};

/**
 * The ribbon to draw, in screen pixels, or null when there is nothing to draw.
 * `origin` is this phone's position, `heading` the fused heading, `path` the route.
 *
 * Takes what is left of the route, the first ROAD_LINE_MAX_DISTANCE_METERS of it, and
 * projects each sample with projectPoint. Samples out of view in the route's first
 * ROAD_LINE_UNDERFOOT_ALONG_M are skipped (see there). From the first sample in
 * view, the ribbon runs until the next one out of view and stops there: it never draws
 * toward a point outside the cone.
 *
 * Returns { points: [{ x, y, distance, width, along }], left, right, nearY, farY }, where
 * left/right are the ribbon's edges (width tapering with distance) and nearY/farY where it
 * starts and ends on screen, for the fade.
 */
export const buildRoadRibbon = ({ origin, heading, path, screenWidth, screenHeight, fovDeg = ASSUMED_CAMERA_FOV_DEG }) => {
  if (!isPoint(origin) || !Number.isFinite(heading) || !(screenWidth > 0) || !(screenHeight > 0)) return null;
  const samples = resamplePath(remainingPath(path, origin));
  if (samples.length < 2) return null;

  const project = (s) =>
    projectPoint({
      origin,
      heading,
      lat: s.lat,
      lng: s.lng,
      screenWidth,
      screenHeight,
      fovDeg,
      screenYFor: roadScreenYFor,
    });

  let i = 0;
  let p = project(samples[i]);
  while (!p && i < samples.length - 1 && samples[i + 1].along <= ROAD_LINE_UNDERFOOT_ALONG_M) {
    i += 1;
    p = project(samples[i]);
  }
  const points = [];
  while (p) {
    points.push({ x: p.x, y: p.y, distance: p.distance, width: widthAt(p.distance), along: samples[i].along });
    i += 1;
    p = i < samples.length ? project(samples[i]) : null;
  }
  if (points.length < 2) return null;

  // Each edge point sits half the width out from the centre line, along the normal of
  // the line's direction on screen at that point.
  const left = [];
  const right = [];
  let normal = { x: 1, y: 0 };
  points.forEach((pt, k) => {
    const prev = points[Math.max(k - 1, 0)];
    const next = points[Math.min(k + 1, points.length - 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) normal = { x: -dy / len, y: dx / len };
    const h = pt.width / 2;
    left.push({ x: pt.x - normal.x * h, y: pt.y - normal.y * h });
    right.push({ x: pt.x + normal.x * h, y: pt.y + normal.y * h });
  });

  return { points, left, right, nearY: points[0].y, farY: points[points.length - 1].y };
};
