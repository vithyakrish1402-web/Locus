import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import planDoc from '../floor7-inputs/floor7_plan.json';
import { PLAN_SCALE, PLAN_SVG, buildPlan, floor7Plan as plan } from '../src/utils/floor7Plan.js';
import { pointInPolygon, segmentsCross } from '../src/utils/floorGeometry.js';

const near = (value, expected, digits = 6) => expect(value).toBeCloseTo(expected, digits);
const at = (name) => {
  const node = plan.nodeNamed(name);
  if (!node) throw new Error(`no station named ${name}`);
  return node;
};
const spot = (id) => planDoc.survey_spots.find((s) => s.place_id === id).point;
const place = (id) => planDoc.places.find((p) => p.id === id).front_point;
const xy = ([x, y]) => ({ x, y });

describe('the inputs in the repo', () => {
  it('are byte for byte what the team sent (floor7-inputs/SHA256SUMS)', () => {
    const dir = join(process.cwd(), 'floor7-inputs');
    const sums = readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/).map((l) => l.split(/\s+\*?/));
    expect(sums.map(([, f]) => f).sort()).toEqual(readdirSync(dir).filter((f) => f !== 'SHA256SUMS' && f !== '.gitattributes').sort());
    for (const [hash, file] of sums) {
      expect(createHash('sha256').update(readFileSync(join(dir, file))).digest('hex'), file).toBe(hash);
    }
  });
});

describe('the plan data itself (the Step 0 checks, kept)', () => {
  const lines = planDoc.corridor_centerline;
  const walkable = planDoc.walkable.filter((w) => w.type === 'corridor' || w.type === 'lift_lobby').map((w) => w.polygon.map(xy));
  const inCorridorSpace = (p) => walkable.some((poly) => pointInPolygon(xy(p), poly));

  it('has every survey spot, station and centreline end inside corridor space', () => {
    for (const s of planDoc.survey_spots) expect(inCorridorSpace(s.point), s.name).toBe(true);
    for (const c of lines) {
      for (const v of c.polyline) expect(inCorridorSpace(v), `${c.id} end`).toBe(true);
      for (const s of c.stations) expect(inCorridorSpace(s.point), s.name).toBe(true);
    }
  });

  it('has no centreline crossing a wall', () => {
    for (const c of lines) {
      for (let i = 0; i < c.polyline.length - 1; i++) {
        for (const w of planDoc.walls) {
          expect(segmentsCross(xy(c.polyline[i]), xy(c.polyline[i + 1]), xy(w.p1), xy(w.p2)), `${c.id} x ${w.id}`).toBe(false);
        }
      }
    }
  });
});

describe('the corridor graph', () => {
  it('is one connected graph', () => {
    expect(plan.isConnected()).toBe(true);
  });

  it('is a tree (an H with dead ends, no loop): one route between any two points', () => {
    expect(plan.edges.length).toBe(plan.nodes.length - 1);
  });

  it('ends in exactly six dead ends: the four spine ends and the two back-path ends', () => {
    const degree = plan.nodes.map(() => 0);
    for (const e of plan.edges) (degree[e.a]++, degree[e.b]++);
    const ends = plan.nodes.filter((n) => degree[n.id] === 1).map((n) => `${n.x},${n.y}`).sort();
    expect(ends).toEqual(['-9,-12', '-9,15', '20,7.9', '37,-12', '37,15', '8,7.9'].sort());
  });

  it('joins the centrelines at the four junctions', () => {
    for (const [name, lines] of [
      ['Junction: west spine / lab passage', ['west_spine', 'passage']],
      ['Junction: lab passage / east spine', ['passage', 'east_spine']],
      ['Junction: west spine / back path', ['west_spine', 'west_back']],
      ['Junction: east spine / back path', ['east_spine', 'east_back']],
    ]) {
      expect(at(name).centrelines.sort(), name).toEqual([...lines].sort());
    }
  });

  it('has a node at every station, and edge lengths that add up to the drawn corridor lengths', () => {
    for (const c of planDoc.corridor_centerline) {
      for (const s of c.stations) expect(plan.nodeNamed(s.name), s.name).toBeTruthy();
      const total = plan.edges.filter((e) => e.centreline === c.id).reduce((sum, e) => sum + e.length, 0);
      near(total, c.length_m);
    }
  });

  it('has no zero-length or doubled edge', () => {
    const seen = new Set();
    for (const e of plan.edges) {
      expect(e.length).toBeGreaterThan(0);
      const key = [e.a, e.b].sort().join('-');
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });
});

describe('snapToCorridor', () => {
  it('leaves a point already on a centreline where it is, moving it 0 m (round trip)', () => {
    for (const n of plan.nodes) {
      const s = plan.snapToCorridor(n.x, n.y);
      near(s.x, n.x);
      near(s.y, n.y);
      near(s.distanceMoved, 0);
      // and snapping the snapped point again changes nothing
      const again = plan.snapToCorridor(s.x, s.y);
      near(again.x, s.x);
      near(again.y, s.y);
    }
  });

  it('reports the edge and how far along it the point is', () => {
    const s = plan.snapToCorridor(-9, 5.25); // Room 702's door, on the west spine
    const e = plan.edges[s.edge];
    expect(e.centreline).toBe('west_spine');
    const a = plan.nodes[e.a];
    near(Math.hypot(s.x - a.x, s.y - a.y), s.offset);
  });

  it('puts a point inside a room onto the corridor in front of it, and says how far it moved', () => {
    const s = plan.snapToCorridor(-14.2, 11.75); // the middle of Room 701
    near(s.x, -9);
    near(s.y, 11.75);
    near(s.distanceMoved, 5.2);
  });

  it('snaps at a junction to the junction', () => {
    const s = plan.snapToCorridor(-9.5, 0.4);
    near(s.x, -9);
    near(s.y, 0.4);
    const corner = plan.snapToCorridor(-9, 0);
    near(corner.distanceMoved, 0);
  });

  it('snaps beyond a dead end to the dead end, not past it', () => {
    const back = plan.snapToCorridor(11, 7.9); // beyond west_back's end at x = 8
    near(back.x, 8);
    near(back.y, 7.9);
    near(back.distanceMoved, 3);
    const south = plan.snapToCorridor(-9, -20); // beyond the south end of the west spine
    near(south.y, -12);
    near(south.distanceMoved, 8);
    const eastBack = plan.snapToCorridor(17, 7.9);
    near(eastBack.x, 20);
  });

  it('puts every point inside a lift lobby on the passage, even at the corner nearer a back path', () => {
    for (const p of [[0, 0], [3, 3.98], [-3.9, 3.98], [3.9, -3.98], [28, 3.98], [31, 3.98], [25, -3.98]]) {
      const s = plan.snapToCorridor(...p);
      expect(plan.edges[s.edge].centreline, String(p)).toBe('passage');
      near(s.y, 0);
    }
    // At that height the back path (centreline y = 7.9) is a hair nearer than the passage: only
    // the lobby rule keeps these on the passage. Just outside the lobby the nearer line wins.
    const outside = plan.snapToCorridor(3, 4.5);
    expect(plan.edges[outside.edge].centreline).toBe('west_back');
  });
});

describe('walkingDistance', () => {
  it('is 0 from a place to itself and the same both ways', () => {
    const a = xy(spot('r701'));
    const b = xy(spot('r704'));
    near(plan.walkingDistance(a, a), 0);
    near(plan.walkingDistance(a, b), plan.walkingDistance(b, a));
  });

  it('is the plain difference for two points on the same stretch between two stations', () => {
    near(plan.walkingDistance({ x: 12, y: 0 }, { x: 15, y: 0 }), 3); // between Lab D (11) and Lab C (17)
    near(plan.walkingDistance({ x: 15, y: 0 }, { x: 12, y: 0 }), 3);
    near(plan.walkingDistance({ x: -9, y: 9 }, { x: -9, y: 10 }), 1); // between Junction 7.9 and Room 701
  });

  it('goes from Room 701 to Room 704 by the west spine, the passage and the east spine: 11.75 + 46 + 11.75', () => {
    near(plan.walkingDistance(xy(spot('r701')), xy(spot('r704'))), 69.5);
  });

  it('is the difference along one corridor when both points are on it', () => {
    near(plan.walkingDistance(xy(spot('r701')), xy(spot('r703A'))), 23.75 - 4.25);
    near(plan.walkingDistance(xy(spot('labC')), xy(spot('lobbyA'))), 17);
  });

  it('is longer on foot than on the map across a wall: the new ladies restroom (W) and the Department door', () => {
    const w = xy(place('rW'));
    const door = xy(spot('dept2'));
    const straight = Math.hypot(w.x - door.x, w.y - door.y);
    near(straight, 8.1, 1);
    near(plan.walkingDistance(w, door), 15 + 7.9 + 17); // out the back path, down the spine, along the passage
  });

  it('measures the back paths as dead ends', () => {
    near(plan.walkingDistance(xy(spot('rNew')), xy(place('rW'))), 11.8); // along west_back
    near(plan.walkingDistance(xy(spot('rNew')), xy(planDoc.corridor_centerline[0].stations.find((s) => s.name.includes('back path')).point)), 3.2);
    near(plan.walkingDistance(xy(place('rW')), xy(spot('r701'))), 15 + 3.85); // W to the spine, then up to 701
    // the far ends of the two back paths: 17 + 7.9 + 46 + 7.9 + 17
    near(plan.walkingDistance({ x: 8, y: 7.9 }, { x: 20, y: 7.9 }), 95.8);
  });

  it('judges a point by where it snaps: a room position counts as its place in the corridor', () => {
    near(plan.walkingDistance({ x: -14.2, y: 11.75 }, { x: 42, y: 11.75 }), 69.5);
  });

  it('accepts snapped points as they come out of snapToCorridor', () => {
    const a = plan.snapToCorridor(-14.2, 11.75);
    const b = plan.snapToCorridor(42, 11.75);
    near(plan.walkingDistance(a, b), 69.5);
  });

  it('is never shorter than the straight line, and obeys the triangle inequality', () => {
    const pts = planDoc.survey_spots.map((s) => xy(s.point));
    for (const a of pts) {
      for (const b of pts) {
        expect(plan.walkingDistance(a, b)).toBeGreaterThanOrEqual(Math.hypot(a.x - b.x, a.y - b.y) - 1e-9);
        for (const c of pts.slice(0, 6)) {
          expect(plan.walkingDistance(a, b)).toBeLessThanOrEqual(plan.walkingDistance(a, c) + plan.walkingDistance(c, b) + 1e-9);
        }
      }
    }
  });

  it('crosses the whole floor between the two south ends: 12 + 46 + 12', () => {
    near(plan.walkingDistance({ x: -9, y: -12 }, { x: 37, y: -12 }), 12 + 46 + 12);
  });
});

describe('PLAN_SCALE', () => {
  const doubled = buildPlan(planDoc, 2);

  it('is a single number in a single place, and the shipped plan uses it', () => {
    expect(PLAN_SCALE).toBe(1);
    expect(plan.scale).toBe(PLAN_SCALE);
    const src = readFileSync(join(process.cwd(), 'src', 'utils', 'floor7Plan.js'), 'utf8');
    expect(src.match(/PLAN_SCALE\s*=/g)).toHaveLength(1);
  });

  it('multiplies every coordinate', () => {
    for (const n of plan.nodes) {
      const m = doubled.nodes[n.id];
      near(m.x, 2 * n.x);
      near(m.y, 2 * n.y);
    }
    near(doubled.walls[10].a.x, 2 * plan.walls[10].a.x);
    near(doubled.spots['Room 701'].y, 2 * plan.spots['Room 701'].y);
    near(doubled.walkable[0][0].x, 2 * plan.walkable[0][0].x);
  });

  it('multiplies every edge length and every walking distance', () => {
    plan.edges.forEach((e, i) => near(doubled.edges[i].length, 2 * e.length));
    const a = xy(spot('r701'));
    const b = xy(spot('r704'));
    const d2 = doubled.walkingDistance({ x: 2 * a.x, y: 2 * a.y }, { x: 2 * b.x, y: 2 * b.y });
    near(d2, 2 * plan.walkingDistance(a, b));
  });

  it('scales the distance a snap moves a point, and the offset along its edge', () => {
    const s1 = plan.snapToCorridor(-14.2, 11.75);
    const s2 = doubled.snapToCorridor(-28.4, 23.5);
    near(s2.distanceMoved, 2 * s1.distanceMoved);
    near(s2.x, 2 * s1.x);
  });

  it('rejects a scale that is not a positive number', () => {
    for (const bad of [0, -1, NaN, Infinity, 'two']) expect(() => buildPlan(planDoc, bad)).toThrow(/PLAN_SCALE/);
  });

  it('keeps the drawing in step: scaled plan points land on the same pixels of the SVG', () => {
    const a = plan.toSvg(-9, 11.75);
    const b = doubled.toSvg(-18, 23.5);
    near(a.x, b.x);
    near(a.y, b.y);
  });
});

describe('the drawing (floor7_plan_v3.svg)', () => {
  const svg = readFileSync(join(process.cwd(), 'floor7-inputs', 'floor7_plan_v3.svg'), 'utf8');

  it('has the size PLAN_SVG says', () => {
    expect(svg).toContain(`viewBox="0 0 ${PLAN_SVG.width} ${PLAN_SVG.height}"`);
  });

  it('puts all 23 survey dots exactly where toSvg() puts the plan\'s survey spots', () => {
    const group = svg.slice(svg.indexOf('<g id="survey_spots">'), svg.indexOf('</g>', svg.indexOf('<g id="survey_spots">')));
    const dots = [...group.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="4.5" fill="#C2410C"/g)].map((m) => [+m[1], +m[2]]);
    expect(dots).toHaveLength(planDoc.survey_spots.length);
    for (const s of planDoc.survey_spots) {
      const p = plan.toSvg(s.point[0], s.point[1]);
      expect(dots.some(([cx, cy]) => Math.abs(cx - p.x) < 1e-6 && Math.abs(cy - p.y) < 1e-6), s.name).toBe(true);
    }
  });
});
