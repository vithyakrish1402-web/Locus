import { describe, it, expect } from 'vitest';
import {
  arRoutePathFor,
  remainingPath,
  resamplePath,
  buildRoadRibbon,
  ROAD_LINE_MAX_DISTANCE_METERS,
  ROAD_LINE_NEAR_WIDTH_PX,
  ROAD_LINE_FAR_WIDTH_PX,
  ROAD_LINE_BAND,
} from '../src/utils/arRoadLine.js';
import { haversineMeters } from '../src/utils/walkingRoute.js';
import { projectScreenY } from '../src/utils/arTags.js';

const START = { lat: 12.8230, lng: 80.0440 };
// A point `north` m north and `east` m east of START.
const pt = (north, east = 0) => ({
  lat: START.lat + north / 111320,
  lng: START.lng + east / (111320 * Math.cos((START.lat * Math.PI) / 180)),
});
const W = 400;
const H = 800;
const ribbon = (path, where, heading = 0) => buildRoadRibbon({ origin: where, heading, path, screenWidth: W, screenHeight: H });
const alongEnd = (r) => r.points[r.points.length - 1].along;

describe('arRoutePathFor', () => {
  const waypoint = { lat: 1, lng: 2, name: 'RALLY' };
  const route = { path: [pt(0), pt(100)], isRealRoute: true };

  it('gives the route when AR Scan is on the Rally Point', () => {
    expect(arRoutePathFor({ lat: 1, lng: 2, name: 'RALLY' }, waypoint, route)).toBe(route.path);
  });

  it('gives nothing for a squad member, even one standing on the Rally Point', () => {
    expect(arRoutePathFor({ lat: 1, lng: 2, name: 'B', memberUid: 'u-b' }, waypoint, route)).toBeNull();
    expect(arRoutePathFor({ lat: 1, lng: 2, name: 'B', memberId: 's-b' }, waypoint, route)).toBeNull();
  });

  it('gives nothing for any other target, or with no Rally Point', () => {
    expect(arRoutePathFor({ lat: 3, lng: 4, name: 'SRM_HQ' }, waypoint, route)).toBeNull();
    expect(arRoutePathFor({ lat: 1, lng: 2 }, null, route)).toBeNull();
    expect(arRoutePathFor(null, waypoint, route)).toBeNull();
  });

  it('gives nothing until a real route exists', () => {
    expect(arRoutePathFor(waypoint, waypoint, { ...route, isRealRoute: false })).toBeNull();
    expect(arRoutePathFor(waypoint, waypoint, null)).toBeNull();
    expect(arRoutePathFor(waypoint, waypoint, { path: [pt(0)], isRealRoute: true })).toBeNull();
  });
});

describe('remainingPath', () => {
  const path = [pt(0), pt(100), pt(200), pt(300)];

  it('drops what has been walked, snapping onto the segment you are on', () => {
    const rest = remainingPath(path, pt(160, 4)); // a little off the route, mid-segment
    expect(rest).toHaveLength(3);
    expect(haversineMeters(rest[0], pt(160))).toBeLessThan(0.5);
    expect(rest.slice(1)).toEqual([path[2], path[3]]);
  });

  it('starts from the first vertex before you set off, and ends at the destination', () => {
    expect(remainingPath(path, pt(-10))[0]).toEqual(path[0]);
    const atEnd = remainingPath(path, pt(310));
    expect(haversineMeters(atEnd[0], path[3])).toBeLessThan(0.01);
  });

  it('is empty for anything unusable', () => {
    expect(remainingPath(null, START)).toEqual([]);
    expect(remainingPath([pt(0)], START)).toEqual([]);
    expect(remainingPath(path, null)).toEqual([]);
    expect(remainingPath([pt(0), { lat: NaN, lng: 1 }], START)).toEqual([]);
  });
});

describe('resamplePath', () => {
  it('samples every step and stops exactly at the limit', () => {
    const s = resamplePath([pt(0), pt(400)], 150, 5);
    expect(s[0].along).toBe(0);
    expect(s[s.length - 1].along).toBe(150);
    expect(haversineMeters(s[s.length - 1], pt(150))).toBeLessThan(0.5);
    expect(s.length).toBe(31);
  });

  it('keeps the route’s corners and stops at its end', () => {
    const s = resamplePath([pt(0), pt(12), pt(12, 12)], 150, 5);
    expect(s.some((p) => haversineMeters(p, pt(12)) < 0.01)).toBe(true);
    expect(haversineMeters(s[s.length - 1], pt(12, 12))).toBeLessThan(0.01);
    expect(s[s.length - 1].along).toBeCloseTo(24, 0);
  });
});

describe('buildRoadRibbon', () => {
  it('gets shorter as you walk the route, never drawing what is behind you', () => {
    const path = [pt(0), pt(100), pt(200)]; // straight north, 200 m
    let prevEnd = Infinity;
    for (const walked of [0, 60, 120, 170, 190]) {
      const r = ribbon(path, pt(walked));
      const drawn = alongEnd(r);
      expect(drawn).toBeCloseTo(Math.min(200 - walked, ROAD_LINE_MAX_DISTANCE_METERS), 0);
      expect(drawn).toBeLessThanOrEqual(prevEnd);
      prevEnd = drawn;
      // Every point is ahead: nothing from the part already walked.
      for (const p of r.points) expect(p.y).toBeLessThan(H);
      expect(r.points.every((p) => p.distance >= 0)).toBe(true);
    }
  });

  it('draws no further than ROAD_LINE_MAX_DISTANCE_METERS along a long route', () => {
    const r = ribbon([pt(0), pt(1000)], pt(0));
    expect(alongEnd(r)).toBe(ROAD_LINE_MAX_DISTANCE_METERS);
    expect(Math.max(...r.points.map((p) => p.distance))).toBeLessThanOrEqual(ROAD_LINE_MAX_DISTANCE_METERS);
  });

  it('stops at the first point out of view instead of drawing through it', () => {
    // North 40 m, east 30 m (out of a 60 deg cone), then north again, back in view.
    const path = [pt(0), pt(40), pt(40, 30), pt(200, 30)];
    const r = ribbon(path, pt(0));
    // Out of view once more than 30 deg east of north: about 23 m into the east leg.
    expect(alongEnd(r)).toBeGreaterThan(40);
    expect(alongEnd(r)).toBeLessThan(40 + 23.2);
    for (const p of r.points) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(W);
    }
  });

  it('starts at your feet even when GPS puts you a few metres off the route', () => {
    const r = ribbon([pt(0), pt(200)], pt(20, 10)); // 10 m east of it, facing north
    expect(r).not.toBeNull();
    // The route runs 10 m to your left, so it enters a 60 deg view ~17 m ahead, at the left edge.
    expect(r.points[0].distance).toBeLessThan(25);
    expect(r.points[0].x).toBeLessThan(W / 4);
  });

  it('draws nothing when the route is well off to the side, or behind you', () => {
    expect(ribbon([pt(0), pt(200)], pt(20, 40))).toBeNull(); // 40 m off: first in view ~69 m along
    expect(ribbon([pt(0), pt(40), pt(40, -200)], pt(0), 180)).toBeNull(); // behind, then off west
    expect(ribbon([pt(0), pt(200)], pt(0), 180)).toBeNull(); // facing away
  });

  it('tapers with distance, and sits lower on screen when nearer', () => {
    const r = ribbon([pt(0), pt(300)], pt(0));
    const [first, last] = [r.points[0], r.points[r.points.length - 1]];
    expect(first.width).toBeGreaterThan(ROAD_LINE_NEAR_WIDTH_PX - 5);
    expect(last.width).toBeCloseTo(ROAD_LINE_FAR_WIDTH_PX, 5);
    for (let k = 1; k < r.points.length; k++) {
      expect(r.points[k].width).toBeLessThanOrEqual(r.points[k - 1].width);
      expect(r.points[k].y).toBeLessThanOrEqual(r.points[k - 1].y);
    }
    // Straight ahead, so the edges sit half a width either side of the centre.
    r.points.forEach((p, k) => {
      expect(r.right[k].x - r.left[k].x).toBeCloseTo(p.width, 6);
    });
    // From low on the screen at your feet up to where a tag that far away sits.
    expect(first.y).toBeGreaterThan((ROAD_LINE_BAND.bottom - 0.05) * H);
    expect(first.y).toBeLessThanOrEqual(ROAD_LINE_BAND.bottom * H);
    expect(last.y).toBeCloseTo(projectScreenY(ROAD_LINE_MAX_DISTANCE_METERS, H), 6);
    for (let k = 1; k < r.points.length; k++) expect(r.points[k].y).toBeLessThan(r.points[k - 1].y);
    expect(r.nearY).toBe(first.y);
    expect(r.farY).toBe(last.y);
  });

  it('draws nothing, and does not throw, for a missing or too-short route', () => {
    for (const path of [null, undefined, [], [pt(0)], [pt(0), pt(0)]]) {
      expect(ribbon(path, pt(0))).toBeNull();
    }
    expect(buildRoadRibbon({ origin: null, heading: 0, path: [pt(0), pt(50)], screenWidth: W, screenHeight: H })).toBeNull();
    expect(ribbon([pt(0), pt(50)], pt(0), NaN)).toBeNull();
  });
});
