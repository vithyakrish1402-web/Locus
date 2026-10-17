// Where a point is on screen relative to the map's centre, from the camera alone. Web Mercator
// with 256 px tiles, which is what both map engines (Google and Leaflet) use, so the building
// cloud can stay on its pin through any pan or zoom without asking either engine to project.

const TILE_PX = 256;

function worldPoint(lat, lng, zoom) {
  const size = TILE_PX * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

/** Pixels the target sits right (dx) and down (dy) of the map's centre. */
export function offsetFromCenter(center, target, zoom) {
  const c = worldPoint(center.lat, center.lng, zoom);
  const t = worldPoint(target.lat, target.lng, zoom);
  return { dx: t.x - c.x, dy: t.y - c.y };
}
