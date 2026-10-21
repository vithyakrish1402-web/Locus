import { describe, it, expect } from 'vitest';
import { trimRouteBehind, OFF_LINE_METERS } from '../src/utils/routeTrim.js';

// A straight line going north, 0.001 deg (~111 m) per leg.
const path = [0, 1, 2, 3].map((i) => ({ lat: 12.8 + i * 0.001, lng: 80.04 }));

describe('trimRouteBehind', () => {
  it('drops what is behind you and starts the line at you', () => {
    const here = { lat: 12.8015, lng: 80.04 }; // half way along leg 2
    const out = trimRouteBehind(path, here);
    expect(out).toHaveLength(3);
    expect(out[0].lat).toBeCloseTo(12.8015, 6);
    expect(out.slice(1)).toEqual(path.slice(2));
  });

  it('keeps the whole line at the start', () => {
    const out = trimRouteBehind(path, path[0]);
    expect(out).toHaveLength(4);
    expect(out[0]).toEqual(path[0]);
  });

  it('leaves a single point at the end', () => {
    const out = trimRouteBehind(path, path[3]);
    expect(out).toHaveLength(2);
    expect(out[0].lat).toBeCloseTo(path[3].lat, 6);
  });

  it('keeps the whole line when you are off it, so rerouting is not hidden by a wrong cut', () => {
    const away = { lat: 12.8015, lng: 80.04 + (OFF_LINE_METERS + 20) / 111000 };
    expect(trimRouteBehind(path, away)).toBe(path);
  });

  it('returns the path untouched with no fix or a path too short to trim', () => {
    expect(trimRouteBehind(path, null)).toBe(path);
    expect(trimRouteBehind([path[0]], path[0])).toEqual([path[0]]);
    expect(trimRouteBehind(null, path[0])).toBeNull();
  });

  it('does not change the route it is given', () => {
    const copy = JSON.parse(JSON.stringify(path));
    trimRouteBehind(path, { lat: 12.8025, lng: 80.04 });
    expect(path).toEqual(copy);
  });
});
