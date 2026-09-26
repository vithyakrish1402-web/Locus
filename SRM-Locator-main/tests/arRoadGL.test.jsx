// @vitest-environment jsdom
//
// AR Scan Stages 5b-5c: 'realistic' mode draws the road line with three.js, through the
// phone's real orientation. Both three.js modules are stood in for, so these run without
// WebGL; the road's maths is tested in arRoadScene.test.js.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { cameraQuaternion, projectGroundPoint } from '../src/utils/arCamera.js';
import { deviceQuaternion, qAngleDeg } from '../src/utils/deviceOrientation.js';

const gl = vi.hoisted(() => ({ loaded: false, views: [], fail: false }));
vi.mock('../src/utils/arRoadScene.js', () => {
  gl.loaded = true;
  return {
    createRoadView: vi.fn(() => {
      if (gl.fail) throw new Error('WebGL unavailable');
      const view = { setRoad: vi.fn(), setOrientation: vi.fn(), setView: vi.fn(), render: vi.fn(), dispose: vi.fn() };
      gl.views.push(view);
      return view;
    }),
  };
});
const arrows = vi.hoisted(() => []);
vi.mock('../src/utils/arArrowScene.js', () => ({
  createArrowView: vi.fn(() => {
    const view = { setRotation: vi.fn(), setView: vi.fn(), render: vi.fn(), dispose: vi.fn() };
    arrows.push(view);
    return view;
  }),
}));

const { default: ARCompass } = await import('../src/ARCompass.jsx');

beforeEach(() => {
  gl.views.length = 0;
  gl.fail = false;
  arrows.length = 0;
});
afterEach(cleanup);

const HERE = { lat: 12.8230, lng: 80.0440 };
const north = (m, east = 0) => ({ lat: HERE.lat + m / 111320, lng: HERE.lng + east / (111320 * Math.cos((HERE.lat * Math.PI) / 180)) });
const RALLY = { name: 'RALLY_ALPHA', ...north(120) };
const ROUTE = [HERE, north(60), north(60, 5), north(120)];

const compass = ({ fidelity = 'realistic', routePath = ROUTE, where = HERE } = {}) => (
  <ARCompass target={RALLY} liveLocation={where} routePath={routePath} fidelity={fidelity} onClose={() => {}} />
);
// A compass reading; with `beta` and `gamma`, the phone's tilt too.
const face = (alpha, beta, gamma) => {
  const event = new Event('deviceorientationabsolute');
  Object.assign(event, { absolute: true, alpha, ...(beta !== undefined ? { beta, gamma } : {}) });
  act(() => window.dispatchEvent(event));
};
const lastOrientation = (view) => view.setOrientation.mock.calls.at(-1)[0];
const expectSameOrientation = (a, b) => expect(qAngleDeg(a, b)).toBeLessThan(1e-4); // acos near 1 limits the precision
// Heading 0 (north) until a compass reading says otherwise. The compass hook emits at
// most one reading per 100 ms, so a test that turns the phone leaves this one out.
const open = async (props, { faceNorth = true } = {}) => {
  const view = render(compass(props));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /GRANT_ACCESS/ })));
  if (faceNorth) face(0);
  await act(async () => {}); // the dynamic imports settle
  return view;
};
const glCanvas = () => screen.queryByTestId('ar-road-gl');
const ribbon = () => screen.queryByTestId('ar-road-line');
const targetTag = () => screen.getAllByTestId('ar-tag').find((t) => t.dataset.variant === 'target');

// Runs first: nothing has loaded the road's three.js module yet in this file.
describe('loading the road’s three.js', () => {
  it('never loads it outside realistic mode, where the Stage 3 ribbon is drawn as before', async () => {
    await open({ fidelity: 'efficient' });
    expect(ribbon()).toBeTruthy();
    cleanup();
    await open({ fidelity: 'standard' });
    expect(ribbon()).toBeTruthy();
    expect(glCanvas()).toBeNull();
    expect(gl.loaded).toBe(false);
  });

  it('never loads it in realistic mode without a road (a squad member, SRM_HQ)', async () => {
    await open({ routePath: null });
    expect(glCanvas()).toBeNull();
    expect(ribbon()).toBeNull();
    expect(gl.loaded).toBe(false);
    expect(arrows).toHaveLength(1); // the three.js arrow still is
  });

  it('loads it in realistic mode with a road, and draws that instead of the Stage 3 ribbon', async () => {
    await open();
    expect(gl.loaded).toBe(true);
    expect(ribbon()).toBeNull();
    expect(glCanvas()).toBeTruthy();
  });
});

describe('the realistic road', () => {
  it('draws under the HUD and the tags, outside the ring, beside the arrow’s own canvas', async () => {
    await open();
    expect(glCanvas().className).toContain('z-[15]');
    expect(screen.getByTestId('ar-arrow-ring').contains(glCanvas())).toBe(false);
    expect(screen.getByTestId('ar-arrow-gl')).toBeTruthy();
    expect(arrows).toHaveLength(1);
    expect(gl.views).toHaveLength(1);
  });

  it('gets the strip of what is left of the route and draws it; with no live tilt, through the fallback camera', async () => {
    await open(); // a compass reading without beta and gamma
    const [view] = gl.views;
    const strip = view.setRoad.mock.calls.at(-1)[0];
    expect(strip.positions.length).toBeGreaterThan(6 * 10);
    expectSameOrientation(lastOrientation(view), cameraQuaternion({ heading: 0, tilt: null }));
    expect(view.setView).toHaveBeenCalled();
    expect(view.render).toHaveBeenCalled();
  });

  it('with a live tilt, draws through the phone’s real orientation', async () => {
    await open(undefined, { faceNorth: false });
    const [view] = gl.views;
    face(0, 60, 4); // upright-ish, 30 deg down, a little rolled
    expectSameOrientation(lastOrientation(view), deviceQuaternion(0, 60, 4));
    expect(qAngleDeg(lastOrientation(view), cameraQuaternion({ heading: 0, tilt: null }))).toBeGreaterThan(5);
  });

  it('only turns the camera when the phone turns, without rebuilding the road', async () => {
    await open(undefined, { faceNorth: false });
    const [view] = gl.views;
    expectSameOrientation(lastOrientation(view), cameraQuaternion({ heading: 0, tilt: null }));
    const builds = view.setRoad.mock.calls.length;
    const frames = view.render.mock.calls.length;
    face(340); // alpha 340 is a heading of 20
    expectSameOrientation(lastOrientation(view), cameraQuaternion({ heading: 20, tilt: null }));
    expect(view.setRoad.mock.calls.length).toBe(builds);
    expect(view.render.mock.calls.length).toBeGreaterThan(frames);
  });

  it('rebuilds the road from scratch when you move: shorter as it is walked', async () => {
    const { rerender } = await open();
    const [view] = gl.views;
    const before = view.setRoad.mock.calls.at(-1)[0].positions.length;
    rerender(compass({ where: north(50) }));
    const after = view.setRoad.mock.calls.at(-1)[0].positions.length;
    expect(after).toBeLessThan(before);
    expect(gl.views).toHaveLength(1); // same canvas, new geometry
  });

  const expectTagThrough = (q) => {
    const at = projectGroundPoint({ q, width: window.innerWidth, height: window.innerHeight, origin: HERE, lat: RALLY.lat, lng: RALLY.lng });
    expect(parseFloat(targetTag().style.left) / 100).toBeCloseTo(at.x, 3);
    expect(parseFloat(targetTag().style.top) / 100).toBeCloseTo(at.y, 3);
  };

  it('puts the Rally Point’s tag where the world camera puts the road’s end', async () => {
    await open();
    expectTagThrough(cameraQuaternion({ heading: 0, tilt: null }));
  });

  it('keeps the Rally Point’s tag on the road’s end as the phone tilts', async () => {
    await open(undefined, { faceNorth: false });
    face(0, 75, -3);
    expectTagThrough(deviceQuaternion(0, 75, -3));
  });

  it('keeps the Stage 3 ribbon, and its tag curve, when WebGL is unavailable', async () => {
    gl.fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rerender } = await open();
    expect(ribbon()).toBeTruthy();
    expect(glCanvas()).toBeNull();
    const standardTop = targetTag().style.top;
    // A new position doesn't retry WebGL.
    rerender(compass({ where: north(5) }));
    await act(async () => {});
    expect(glCanvas()).toBeNull();
    expect(ribbon()).toBeTruthy();
    expect(standardTop).not.toBe('');
    warn.mockRestore();
  });

  it('releases WebGL when the road goes, and when AR Scan closes', async () => {
    const { rerender, unmount } = await open();
    const [first] = gl.views;
    rerender(compass({ routePath: null }));
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(glCanvas()).toBeNull();

    rerender(compass());
    await act(async () => {});
    expect(gl.views).toHaveLength(2);
    expect(ribbon()).toBeNull();
    unmount();
    expect(gl.views[1].dispose).toHaveBeenCalledTimes(1);
  });

  it('redraws at the new size when the canvas is resized, not only the window', async () => {
    const observed = [];
    globalThis.ResizeObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { observed.push({ el, cb: this.cb }); }
      disconnect() {}
    };
    try {
      await open();
      const [view] = gl.views;
      const entry = observed.find((o) => o.el === glCanvas());
      expect(entry).toBeTruthy();
      const calls = view.setView.mock.calls.length;
      act(() => entry.cb([]));
      expect(view.setView.mock.calls.length).toBe(calls + 1);
    } finally {
      delete globalThis.ResizeObserver;
    }
  });

  it('releases WebGL and goes back to the ribbon when the mode changes', async () => {
    const { rerender } = await open();
    rerender(compass({ fidelity: 'standard' }));
    expect(gl.views[0].dispose).toHaveBeenCalledTimes(1);
    expect(glCanvas()).toBeNull();
    expect(ribbon()).toBeTruthy();
  });
});
