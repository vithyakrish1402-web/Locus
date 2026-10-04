import { describe, it, expect } from 'vitest';
import {
  createPositionFilter,
  stickyDistance,
  formatArDistance,
  GPS_MAX_ACCURACY_M,
  DISTANCE_DEADBAND_M,
} from '../src/utils/arPosition.js';

const BASE = { lat: 12.823, lng: 80.044 };
const north = (m) => ({ lat: BASE.lat + m / 111320, lng: BASE.lng });
const metresNorth = (p) => (p.lat - BASE.lat) * 111320;

describe('createPositionFilter', () => {
  it('takes the first accepted fix as-is', () => {
    const f = createPositionFilter();
    expect(f.update({ ...BASE, accuracy: 8, timestamp: 0 })).toEqual({ accepted: true, position: BASE });
  });

  it(`ignores fixes vaguer than ${GPS_MAX_ACCURACY_M} m, or without an accuracy`, () => {
    const f = createPositionFilter();
    expect(f.update({ ...BASE, accuracy: GPS_MAX_ACCURACY_M + 1, timestamp: 0 })).toEqual({ accepted: false, position: null });
    expect(f.update({ ...BASE, accuracy: undefined, timestamp: 0 }).accepted).toBe(false);
    f.update({ ...BASE, accuracy: 5, timestamp: 0 });
    const jump = f.update({ ...north(200), accuracy: 80, timestamp: 1000 });
    expect(jump.accepted).toBe(false);
    expect(jump.position).toEqual(BASE);
  });

  it('weighs each fix by its accuracy: a sharp one pulls hard, a vague one barely', () => {
    const sharp = createPositionFilter();
    sharp.update({ ...BASE, accuracy: 20, timestamp: 0 });
    const a = metresNorth(sharp.update({ ...north(10), accuracy: 3, timestamp: 1000 }).position);
    const vague = createPositionFilter();
    vague.update({ ...BASE, accuracy: 3, timestamp: 0 });
    const b = metresNorth(vague.update({ ...north(10), accuracy: 25, timestamp: 1000 }).position);
    expect(a).toBeGreaterThan(8);
    expect(b).toBeLessThan(2);
  });

  it('lets a long gap count for more, as the phone could have moved', () => {
    const soon = createPositionFilter();
    soon.update({ ...BASE, accuracy: 5, timestamp: 0 });
    const late = createPositionFilter();
    late.update({ ...BASE, accuracy: 5, timestamp: 0 });
    const s = metresNorth(soon.update({ ...north(10), accuracy: 10, timestamp: 500 }).position);
    const l = metresNorth(late.update({ ...north(10), accuracy: 10, timestamp: 20000 }).position);
    expect(l).toBeGreaterThan(s);
  });

  it('settles on a still phone instead of wandering with each fix', () => {
    const f = createPositionFilter();
    let p;
    for (let i = 0; i < 30; i++) {
      p = f.update({ ...north(i % 2 ? 4 : -4), accuracy: 8, timestamp: i * 1000 }).position;
    }
    expect(Math.abs(metresNorth(p))).toBeLessThan(2);
  });
});

describe('stickyDistance', () => {
  it(`moves only once the change reaches ${DISTANCE_DEADBAND_M} m`, () => {
    expect(stickyDistance(null, 120)).toBe(120);
    expect(stickyDistance(120, 121)).toBe(120);
    expect(stickyDistance(120, 119)).toBe(120);
    expect(stickyDistance(120, 122)).toBe(122);
    expect(stickyDistance(120, 118)).toBe(118);
  });
});

describe('formatArDistance', () => {
  it('rounds the same way everywhere: whole metres, then tenths of a km', () => {
    expect(formatArDistance(0)).toBe('0 M');
    expect(formatArDistance(349.6)).toBe('350 M');
    expect(formatArDistance(999)).toBe('999 M');
    expect(formatArDistance(1000)).toBe('1.0 KM');
    expect(formatArDistance(1460)).toBe('1.5 KM');
    expect(formatArDistance(350, '')).toBe('350M');
    expect(formatArDistance(undefined)).toBe('0 M');
  });
});
