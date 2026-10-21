// @vitest-environment jsdom
//
// Real routes use round dots with a casing; the fallback remains a sparse dash.
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
  window.google = { maps: { Polyline: FakePolyline, SymbolPath: { CIRCLE: 0 } } };
});
afterEach(() => {
  cleanup();
  delete window.google;
});

describe('a real route', () => {
  it('draws separated round dots with matching casing dots and no solid stroke', () => {
    renderHook(() => useWaypointNavigationLine(MAP, PATH, true, '#123456', '#ABCDEF'));
    const [casing, line] = shown();
    expect(shown()).toHaveLength(2);
    for (const [polyline, color, diameter] of [[casing, '#ABCDEF', ROUTE_CASING_WIDTH], [line, '#123456', ROUTE_WIDTH]]) {
      expect(polyline.options.strokeOpacity).toBe(0);
      expect(polyline.options.icons[0]).toMatchObject({ offset: '0', repeat: '16px', icon: {
        path: 0, fillColor: color, fillOpacity: 1, strokeOpacity: 0, scale: diameter / 2,
      } });
    }
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

  it('turning into a real route swaps the dash for round dots on their casing', () => {
    const { rerender } = renderHook(({ real }) => useWaypointNavigationLine(MAP, PATH, real, '#123456', '#ABCDEF'), { initialProps: { real: false } });
    rerender({ real: true });
    expect(shown()).toHaveLength(2);
    expect(shown().every((l) => l.options.icons[0].repeat === '16px')).toBe(true);
  });
});
