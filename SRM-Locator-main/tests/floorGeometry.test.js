import { describe, expect, it } from 'vitest';
import { inWalkable, pathCrossesWall, pointInPolygon, segmentsCross, snapToWalkable } from '../src/utils/floorGeometry.js';

const P = (x, y) => ({ x, y });
// A wall down x = 10 with a doorway between y = 4 and y = 6.
const walls = [{ a: P(10, 0), b: P(10, 4) }, { a: P(10, 6), b: P(10, 10) }];
const room = [P(0, 0), P(20, 0), P(20, 10), P(0, 10)];

describe('wall crossing', () => {
  it('rejects a path straight through a wall', () => {
    expect(pathCrossesWall(P(8, 2), P(12, 2), walls)).toBe(true);
    expect(pathCrossesWall(P(12, 9), P(8, 8), walls)).toBe(true);
  });

  it('allows a path through the doorway gap', () => {
    expect(pathCrossesWall(P(8, 5), P(12, 5), walls)).toBe(false);
  });

  it('allows standing next to a wall, or ending on it, without crossing', () => {
    expect(pathCrossesWall(P(9, 2), P(9.9, 3), walls)).toBe(false); // beside it
    expect(pathCrossesWall(P(8, 2), P(10, 2), walls)).toBe(false); // ending on it
    expect(pathCrossesWall(P(10, 1), P(10, 3), walls)).toBe(false); // along it
    expect(pathCrossesWall(P(9, 5), P(10, 4), walls)).toBe(false); // touching the end of it
  });

  it('a path that passes the end of a wall without touching it is clear', () => {
    expect(segmentsCross(P(8, 3.9), P(12, 4.1), P(10, 0), P(10, 3.5))).toBe(false);
  });
});

describe('walkable space', () => {
  it('knows inside, outside and the edge', () => {
    expect(pointInPolygon(P(5, 5), room)).toBe(true);
    expect(pointInPolygon(P(25, 5), room)).toBe(false);
    expect(pointInPolygon(P(20, 5), room)).toBe(true);
    expect(pointInPolygon(P(0, 0), room)).toBe(true);
  });

  it('handles an L-shaped polygon', () => {
    const l = [P(0, 0), P(10, 0), P(10, 4), P(4, 4), P(4, 10), P(0, 10)];
    expect(pointInPolygon(P(2, 8), l)).toBe(true);
    expect(pointInPolygon(P(8, 8), l)).toBe(false);
  });

  it('leaves a point that is already walkable alone', () => {
    const p = P(5, 5);
    expect(snapToWalkable(p, [room])).toBe(p);
  });

  it('snaps an outside point to the nearest edge', () => {
    expect(snapToWalkable(P(25, 5), [room])).toEqual(P(20, 5));
    expect(snapToWalkable(P(-3, -4), [room])).toEqual(P(0, 0));
  });

  it('snaps to the nearest of several polygons', () => {
    const other = [P(30, 0), P(40, 0), P(40, 10), P(30, 10)];
    const s = snapToWalkable(P(28, 5), [room, other]);
    expect(s).toEqual(P(30, 5));
    expect(inWalkable(s, [room, other])).toBe(true);
  });

  it('with no polygons, does nothing', () => {
    const p = P(99, 99);
    expect(snapToWalkable(p, [])).toBe(p);
  });
});
