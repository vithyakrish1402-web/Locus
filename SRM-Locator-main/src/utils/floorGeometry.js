// Wall and walkable-space maths for the indoor position filter. Plain geometry in metres, no
// dependencies. Points are { x, y }; a wall is { a: {x,y}, b: {x,y} }; a walkable area is a
// polygon, an array of points (first point not repeated).
//
// Touching is not crossing: a path that ends ON a wall, or runs along it, has not passed
// through it. That matters because snapping a point back into walkable space puts it on the
// boundary, which is usually a wall line.

const EPS = 1e-9;

const cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
const sign = (v) => (v > EPS ? 1 : v < -EPS ? -1 : 0);

/** True only when the two segments properly cross, each strictly on both sides of the other. */
export function segmentsCross(p1, p2, q1, q2) {
  const d1 = sign(cross(q1, q2, p1));
  const d2 = sign(cross(q1, q2, p2));
  const d3 = sign(cross(p1, p2, q1));
  const d4 = sign(cross(p1, p2, q2));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True if the straight path from `from` to `to` passes through any wall. */
export function pathCrossesWall(from, to, walls) {
  return walls.some((w) => segmentsCross(from, to, w.a, w.b));
}

function onSegment(p, a, b) {
  if (Math.abs(cross(a, b, p)) > EPS * 1e3) return false;
  return (
    p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS
  );
}

/** Inside or on the edge of one polygon (ray casting). */
export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (onSegment(p, a, b)) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const inWalkable = (p, walkable) => walkable.some((poly) => pointInPolygon(p, poly));

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * `p` itself when it is in walkable space, otherwise the nearest point on the edge of any
 * walkable polygon. With no walkable polygons, `p` is returned unchanged.
 */
export function snapToWalkable(p, walkable) {
  if (walkable.length === 0 || inWalkable(p, walkable)) return p;
  let best = p;
  let bestDist = Infinity;
  for (const poly of walkable) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const c = closestOnSegment(p, poly[j], poly[i]);
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
  }
  return best;
}
