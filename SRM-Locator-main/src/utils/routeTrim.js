// The route line behind you disappears as you walk: only what is still ahead is drawn.
// Display only: the route itself (navigation steps, distances, rerouting) is never changed.

const EARTH_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

// Further than this from the line and you are off it (the navigation controller reroutes
// then), so the whole line stays rather than being cut at a wrong point.
export const OFF_LINE_METERS = 40;

/**
 * The part of `path` still ahead of `position`: the point on the line nearest you, then the
 * remaining vertices. Returns `path` itself when there is nothing to trim (no fix, a path of
 * under two points, or you are more than OFF_LINE_METERS from the line).
 *
 * @param {{lat:number,lng:number}[]|null|undefined} path
 * @param {{lat:number,lng:number}|null|undefined} position
 */
export function trimRouteBehind(path, position) {
  if (!Array.isArray(path) || path.length < 2 || !position) return path;
  const cosLat = Math.cos(toRad(position.lat));
  // Metres east / north of you, flat-earth: exact enough over a campus.
  const xy = (p) => [toRad(p.lng - position.lng) * cosLat * EARTH_M, toRad(p.lat - position.lat) * EARTH_M];

  let best = { dist: Infinity, index: 0, t: 0 };
  for (let i = 0; i < path.length - 1; i += 1) {
    const [ax, ay] = xy(path[i]);
    const [bx, by] = xy(path[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const dist = Math.hypot(ax + t * dx, ay + t * dy);
    if (dist < best.dist) best = { dist, index: i, t };
  }
  if (best.dist > OFF_LINE_METERS) return path;

  const a = path[best.index];
  const b = path[best.index + 1];
  const here = { lat: a.lat + (b.lat - a.lat) * best.t, lng: a.lng + (b.lng - a.lng) * best.t };
  return [here, ...path.slice(best.index + 1)];
}
