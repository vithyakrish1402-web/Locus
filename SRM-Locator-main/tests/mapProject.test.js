import { describe, it, expect } from 'vitest';
import { offsetFromCenter } from '../src/utils/mapProject';

const C = { lat: 12.8234851, lng: 80.042357 };

describe('offsetFromCenter', () => {
  it('is zero at the centre itself', () => {
    expect(offsetFromCenter(C, C, 19)).toEqual({ dx: 0, dy: 0 });
  });
  it('puts a point east to the right and north above (screen y grows downward)', () => {
    const { dx, dy } = offsetFromCenter(C, { lat: C.lat + 0.0005, lng: C.lng + 0.001 }, 19);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
  });
  it('matches the known scale: 0.001 deg of longitude at zoom 19 is ~373 px', () => {
    const { dx } = offsetFromCenter(C, { lat: C.lat, lng: C.lng + 0.001 }, 19);
    expect(dx).toBeCloseTo((256 * 2 ** 19 * 0.001) / 360, 3);
  });
  it('doubles when the zoom goes up one level, so the cloud follows a zoom', () => {
    const t = { lat: C.lat + 0.0003, lng: C.lng - 0.0004 };
    const a = offsetFromCenter(C, t, 18);
    const b = offsetFromCenter(C, t, 19);
    expect(b.dx / a.dx).toBeCloseTo(2, 6);
    expect(b.dy / a.dy).toBeCloseTo(2, 6);
  });
});
