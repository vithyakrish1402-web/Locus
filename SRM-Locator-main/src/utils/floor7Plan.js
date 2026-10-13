// The TECH PARK Floor 7 plan as the indoor position code uses it: the corridor graph, snapping
// onto a corridor, and walking distance along it. Test build only (see floor7Demo.js); nothing
// outside the "LOCUS Test" build imports this file or the plan data behind it.
//
// The data is floor7-inputs/floor7_plan.json, read as it came and never edited. Units are
// metres, x east, y north, origin at the centre of lift lobby A. **The scale is estimated, not
// measured**: PLAN_SCALE is the one place that says so. Every coordinate and every distance
// below is the plan's number times it, so a tape measurement fixes everything with one edit.
//
// The walkable space is an H with two dead ends, not a ring: one route between any two points,
// so walking distance can be far longer than the straight line (the new ladies restroom is
// ~8 m from the Department door in a straight line and ~40 m on foot).

import planDoc from '../../floor7-inputs/floor7_plan.json';
import { pointInPolygon, segmentsCross } from './floorGeometry.js';

/** Plan metres -> real metres. 1.0 until someone paces the passage (drawn 46 m, a guess). */
export const PLAN_SCALE = 1.0;

/**
 * Where plan metres land in floor7_plan_v3.svg (1400 x 1060, 20 px per drawn metre, x = 0 at
 * 420 px and y = 0 at 500 px): measured off the drawing itself, and tested against its dots.
 */
export const PLAN_SVG = { width: 1400, height: 1060, originX: 420, originY: 500, pxPerM: 20 };

const KEY_PRECISION = 1e6;
const keyOf = (x, y) => `${Math.round(x * KEY_PRECISION)},${Math.round(y * KEY_PRECISION)}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function closestOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

/** Distance along a polyline to the point on it nearest `p`. */
function arcLengthTo(polyline, p) {
  let best = { d: Infinity, along: 0 };
  let along = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const c = closestOnSegment(p, a, b);
    const d = dist(p, c);
    if (d < best.d) best = { d, along: along + dist(a, c) };
    along += dist(a, b);
  }
  return best.along;
}

/**
 * Builds the plan from the raw plan document. `scale` defaults to PLAN_SCALE; tests pass
 * others to check that everything moves together.
 *
 * @param {object} doc floor7_plan.json
 * @param {number} [scale]
 */
export function buildPlan(doc, scale = PLAN_SCALE) {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`PLAN_SCALE must be a positive number, got ${scale}`);
  const pt = ([x, y]) => ({ x: x * scale, y: y * scale });

  // ------------------------------------------------------------ graph
  // Nodes sit at junctions, line ends, bends and every station. Two centrelines that share a
  // point (the junction stations name it on both) share the node, which is what joins them.
  const nodes = [];
  const nodeByKey = new Map();
  const nodeAt = (xy, name) => {
    const key = keyOf(xy[0], xy[1]);
    let node = nodeByKey.get(key);
    if (!node) {
      node = { id: nodes.length, ...pt(xy), names: [], centrelines: [] };
      nodes.push(node);
      nodeByKey.set(key, node);
    }
    if (name && !node.names.includes(name)) node.names.push(name);
    return node;
  };

  const edges = [];
  const centrelines = [];
  for (const c of doc.corridor_centerline) {
    const line = c.polyline.map(pt);
    centrelines.push({ id: c.id, points: line, widthM: c.width_m * scale, confidence: c.confidence });
    const onLine = []; // { node, along }
    c.polyline.forEach((v) => onLine.push({ node: nodeAt(v), along: arcLengthTo(line, pt(v)) }));
    for (const s of c.stations) onLine.push({ node: nodeAt(s.point, s.name), along: arcLengthTo(line, pt(s.point)) });
    onLine.sort((a, b) => a.along - b.along);
    let prev = null;
    for (const entry of onLine) {
      entry.node.centrelines.includes(c.id) || entry.node.centrelines.push(c.id);
      if (prev && prev.node !== entry.node) {
        edges.push({ id: edges.length, a: prev.node.id, b: entry.node.id, centreline: c.id, length: entry.along - prev.along });
      }
      prev = entry;
    }
  }

  const adjacency = nodes.map(() => []);
  for (const e of edges) {
    adjacency[e.a].push({ to: e.b, edge: e.id, length: e.length });
    adjacency[e.b].push({ to: e.a, edge: e.id, length: e.length });
  }

  // ------------------------------------------------------------ the drawing's shapes
  const polygon = (w) => w.polygon.map(pt);
  const walkable = doc.walkable.filter((w) => w.type === 'corridor' || w.type === 'lift_lobby').map(polygon);
  const lobbies = doc.walkable.filter((w) => w.type === 'lift_lobby').map((w) => ({ id: w.id, polygon: polygon(w) }));
  const walls = doc.walls.map((w) => ({ id: w.id, a: pt(w.p1), b: pt(w.p2), confidence: w.confidence }));
  const spots = Object.fromEntries(doc.survey_spots.map((s) => [s.name, pt(s.point)]));

  // A point inside a lift lobby belongs to the corridor that runs through it (the passage),
  // not to whichever back path happens to be nearer that corner of the lobby.
  const throughLobby = (lobby) =>
    new Set(
      edges
        .filter((e) => {
          const a = nodes[e.a];
          const b = nodes[e.b];
          const poly = lobby.polygon;
          if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
          return poly.some((v, i) => segmentsCross(a, b, v, poly[(i + 1) % poly.length]));
        })
        .map((e) => e.centreline)
    );
  const lobbyLines = lobbies.map((l) => ({ polygon: l.polygon, lines: throughLobby(l) }));

  // ------------------------------------------------------------ snapping
  /**
   * The nearest point on any corridor centreline.
   * @returns {{x:number, y:number, edge:number, offset:number, distanceMoved:number}}
   *   `offset` is the distance along `edge` from its `a` node; `distanceMoved` how far the
   *   point had to move.
   */
  function snapToCorridor(x, y) {
    const p = { x, y };
    const lobby = lobbyLines.find((l) => pointInPolygon(p, l.polygon));
    let best = null;
    for (const e of edges) {
      if (lobby && !lobby.lines.has(e.centreline)) continue;
      const a = nodes[e.a];
      const b = nodes[e.b];
      const c = closestOnSegment(p, a, b);
      const d = dist(p, c);
      if (!best || d < best.distanceMoved) best = { x: c.x, y: c.y, edge: e.id, offset: c.t * e.length, distanceMoved: d };
    }
    return best;
  }

  // ------------------------------------------------------------ walking distance
  const asSnapped = (p) => (Number.isInteger(p.edge) && Number.isFinite(p.offset) ? p : snapToCorridor(p.x, p.y));

  /** Shortest walk, in metres, from the nearest corridor point of `a` to that of `b`. */
  function walkingDistance(a, b) {
    const from = asSnapped(a);
    const to = asSnapped(b);
    const best = new Array(nodes.length).fill(Infinity);
    const done = new Array(nodes.length).fill(false);
    const ea = edges[from.edge];
    best[ea.a] = from.offset;
    best[ea.b] = Math.min(best[ea.b], ea.length - from.offset);
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && best[i] < Infinity && (u < 0 || best[i] < best[u])) u = i;
      if (u < 0) break;
      done[u] = true;
      for (const { to: v, length } of adjacency[u]) best[v] = Math.min(best[v], best[u] + length);
    }
    const eb = edges[to.edge];
    let result = Math.min(best[eb.a] + to.offset, best[eb.b] + (eb.length - to.offset));
    if (from.edge === to.edge) result = Math.min(result, Math.abs(from.offset - to.offset));
    return result;
  }

  // ------------------------------------------------------------ the drawing
  /** Plan metres -> pixels in floor7_plan_v3.svg. */
  const toSvg = (x, y) => ({
    x: PLAN_SVG.originX + (x / scale) * PLAN_SVG.pxPerM,
    y: PLAN_SVG.originY - (y / scale) * PLAN_SVG.pxPerM,
  });

  /** True when every node can be reached from every other. */
  const isConnected = () => {
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) for (const { to } of adjacency[stack.pop()]) if (!seen.has(to)) (seen.add(to), stack.push(to));
    return seen.size === nodes.length;
  };

  return {
    scale,
    nodes,
    edges,
    centrelines,
    walkable,
    lobbies: lobbies.map((l) => l.polygon),
    walls,
    spots,
    snapToCorridor,
    walkingDistance,
    toSvg,
    isConnected,
    /** The node named `name` (a station name from the plan), or undefined. */
    nodeNamed: (name) => nodes.find((n) => n.names.includes(name)),
  };
}

export const floor7Plan = buildPlan(planDoc, PLAN_SCALE);
