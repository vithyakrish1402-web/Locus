// @vitest-environment jsdom
//
// The walking line on the Google map (Map batch fix 5): a real route is the design's solid
// 5 px line on a 9 px casing; the straight-line "best effort" fallback stays a sparse, light
// dash with no casing, so it reads as less certain.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useWaypointNavigationLine, ROUTE_WIDTH, ROUTE_CASING_WIDTH } from '../src/hooks/useWaypointNavigationLine.js';

let lines;
class FakePolyline {
  constructor(options) {
    this.options = options;
    this.path = options.path;
    this.onMap = Boolean(options.map);
    lines.push(this);
  }
  setMap(map) { this.onMap = Boolean(map); }
  setPath(path) { this.path = path; }
}

const MAP = {};
const PATH = [{ lat: 12.8231, lng: 80.0442 }, { lat: 12.824, lng: 80.045 }];
const shown = () => lines.filter((l) => l.onMap);

beforeEach(() => {
  lines = [];
  window.google = { maps: { Polyline: FakePolyline } };
});
afterEach(() => {
  cleanup();
  delete window.google;
});

describe('a real route', () => {
  it('is solid, 5 px, on a 9 px casing in the casing colour, the line on top', () => {
    renderHook(() => useWaypointNavigationLine(MAP, PATH, true, '#123456', '#ABCDEF'));
    const [casing, line] = shown();
    expect(shown()).toHaveLength(2);
    expect([ROUTE_WIDTH, ROUTE_CASING_WIDTH]).toEqual([5, 9]);
    expect(casing.options).toMatchObject({ strokeColor: '#ABCDEF', strokeWeight: 9, strokeOpacity: 1 });
    expect(line.options).toMatchObject({ strokeColor: '#123456', strokeWeight: 5, strokeOpacity: 1 });
    expect(line.options.icons).toBeUndefined();
    expect(line.options.zIndex).toBeGreaterThan(casing.options.zIndex);
  });

  it('follows you: both lines move to the new path, not redrawn', () => {
    const { rerender } = renderHook(({ path }) => useWaypointNavigationLine(MAP, path, true, '#123456', '#ABCDEF'), { initialProps: { path: PATH } });
    const next = [PATH[0], { lat: 12.825, lng: 80.046 }];
    rerender({ path: next });
    expect(lines).toHaveLength(2);
    shown().forEach((l) => expect(l.path).toBe(next));
  });

  it('a theme change redraws both in the new colours', () => {
    const { rerender } = renderHook(({ c }) => useWaypointNavigationLine(MAP, PATH, true, c[0], c[1]), { initialProps: { c: ['#111111', '#FFFFFF'] } });
    rerender({ c: ['#222222', '#0E1116'] });
    expect(shown().map((l) => l.options.strokeColor)).toEqual(['#0E1116', '#222222']);
  });

  it('a casing colour change alone redraws it too', () => {
    const { rerender } = renderHook(({ casing }) => useWaypointNavigationLine(MAP, PATH, true, '#111111', casing), { initialProps: { casing: '#FFFFFF' } });
    rerender({ casing: '#0E1116' });
    expect(shown()[0].options.strokeColor).toBe('#0E1116');
  });

  it('is removed, casing and all, when the route ends', () => {
    const { rerender } = renderHook(({ path }) => useWaypointNavigationLine(MAP, path, true, '#123456', '#ABCDEF'), { initialProps: { path: PATH } });
    rerender({ path: null });
    expect(shown()).toHaveLength(0);
  });

  it('is removed when the map goes away', () => {
    const { unmount } = renderHook(() => useWaypointNavigationLine(MAP, PATH, true, '#123456', '#ABCDEF'));
    unmount();
    expect(shown()).toHaveLength(0);
  });
});

describe('the best-effort straight line', () => {
  it('stays a sparse, light dash with no casing', () => {
    renderHook(() => useWaypointNavigationLine(MAP, PATH, false, '#123456', '#ABCDEF'));
    expect(shown()).toHaveLength(1);
    const [line] = shown();
    expect(line.options.strokeOpacity).toBe(0);
    expect(line.options.icons[0]).toMatchObject({ repeat: '22px', icon: { strokeColor: '#123456', strokeOpacity: 0.45 } });
  });

  it('turning into a real route swaps the dash for the solid line on its casing', () => {
    const { rerender } = renderHook(({ real }) => useWaypointNavigationLine(MAP, PATH, real, '#123456', '#ABCDEF'), { initialProps: { real: false } });
    rerender({ real: true });
    expect(shown()).toHaveLength(2);
    expect(shown().every((l) => !l.options.icons)).toBe(true);
  });
});
