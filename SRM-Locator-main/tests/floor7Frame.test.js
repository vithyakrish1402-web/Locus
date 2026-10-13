import { describe, expect, it } from 'vitest';
import { calculateDistanceMeters } from '../src/utils/geoMath.js';
import { FLOOR7_ORIGIN, toGeo, toLocal } from '../src/utils/floor7Frame.js';

describe('Floor 7 metres frame', () => {
  it('puts the origin at (0, 0)', () => {
    const p = toLocal(FLOOR7_ORIGIN.lat, FLOOR7_ORIGIN.lng);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('x is east and y is north when the rotation is 0', () => {
    const east = toLocal(FLOOR7_ORIGIN.lat, FLOOR7_ORIGIN.lng + 0.0001);
    const north = toLocal(FLOOR7_ORIGIN.lat + 0.0001, FLOOR7_ORIGIN.lng);
    expect(east.x).toBeGreaterThan(9);
    expect(Math.abs(east.y)).toBeLessThan(1e-9);
    expect(north.y).toBeGreaterThan(10);
    expect(Math.abs(north.x)).toBeLessThan(1e-9);
  });

  it.each([0, 37, 90, -120])('round-trips to well under a millimetre at rotation %i', (rot) => {
    for (const [x, y] of [[0, 0], [60, -45], [-80, 30], [12.34, 56.78]]) {
      const g = toGeo(x, y, FLOOR7_ORIGIN, rot);
      const back = toLocal(g.lat, g.lng, FLOOR7_ORIGIN, rot);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });

  it('agrees with the great-circle distance to within 0.1 m over 100 m', () => {
    const a = toGeo(0, 0);
    const b = toGeo(60, 80); // 100 m away
    const real = calculateDistanceMeters(a.lat, a.lng, b.lat, b.lng);
    expect(Math.abs(real - 100)).toBeLessThan(0.1);
  });

  it('rotation turns the plan axes: a plan-x step at 90 degrees is due north', () => {
    const g = toGeo(10, 0, FLOOR7_ORIGIN, 90);
    expect(g.lat).toBeGreaterThan(FLOOR7_ORIGIN.lat);
    expect(g.lng).toBeCloseTo(FLOOR7_ORIGIN.lng, 9);
  });
});
