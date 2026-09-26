// AR Scan Stages 5b-5c: the 'realistic' road line, a real-world strip on the ground seen
// through a camera in metres, oriented as the phone really is. Tested without WebGL
// (three.js's maths runs anywhere).
import { describe, it, expect } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { buildRoadScene } from '../src/utils/arRoadScene.js';
import {
  buildRoadStrip,
  remainingRouteSamples,
  resamplePath,
  remainingPath,
  ROAD_LINE_WORLD_WIDTH_M,
  ROAD_LINE_MAX_DISTANCE_METERS,
  ROAD_LINE_NEAR_OPACITY,
  ROAD_LINE_FAR_OPACITY,
} from '../src/utils/arRoadLine.js';
import { AR_CAMERA_HEIGHT_M, FALLBACK_PITCH_DEG, cameraQuaternion, projectGroundPoint, verticalFovDeg } from '../src/utils/arCamera.js';
import { deviceQuaternion, headingFromQuaternion, qRotate } from '../src/utils/deviceOrientation.js';
import { ASSUMED_CAMERA_FOV_DEG, selectArTags } from '../src/utils/arTags.js';

const START = { lat: 12.8230, lng: 80.0440 };
const pt = (north, east = 0) => ({
  lat: START.lat + north / 111320,
  lng: START.lng + east / (111320 * Math.cos((START.lat * Math.PI) / 180)),
});
const W = 400;
const H = 800;
const tan = (deg) => Math.tan((deg * Math.PI) / 180);

const DEG = Math.PI / 180;

// The road's scene, its camera facing `heading`, with the phone's live `tilt` (null: none).
const scene = (heading = 0, tilt = null) => {
  const view = buildRoadScene();
  view.setView({ width: W, height: H });
  view.setOrientation(cameraQuaternion({ heading, tilt }));
  view.camera.updateMatrixWorld(true);
  return view;
};
// A live tilt, as useDeviceHeading reports it, for a phone whose camera faces `heading`,
// `pitch` up from level and rolled `roll` clockwise.
const tiltFor = (heading, pitch, roll) => {
  const q = new Quaternion().setFromEuler(new Euler(pitch * DEG, -heading * DEG, -roll * DEG, 'YXZ')).toArray();
  return { q, heading: headingFromQuaternion(q) };
};
const lookOf = (view) => view.camera.getWorldDirection(new Vector3());
const TILTS = [null, tiltFor(0, -20, 0), tiltFor(40, -35, 8), tiltFor(-10, 5, -12), tiltFor(0, -60, 30)];
// Where the camera puts a ground point (x east, z south, in metres), in screen pixels.
const screenOf = (view, x, z, y = 0) => {
  const p = new Vector3(x, y, z).project(view.camera);
  return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H };
};
// The strip's vertex pairs (left, right), in three.js world coordinates.
const pairs = (strip) => {
  const out = [];
  for (let i = 0; i < strip.positions.length; i += 6) {
    const [lx, ly, lz, rx, ry, rz] = strip.positions.slice(i, i + 6);
    out.push([new Vector3(lx, ly, lz), new Vector3(rx, ry, rz)]);
  }
  return out;
};
const stripFor = (path, where = START) => buildRoadStrip(remainingRouteSamples(path, where), where);

describe('the world camera', () => {
  it('sees ASSUMED_CAMERA_FOV_DEG across, converted to three.js’s vertical field of view', () => {
    expect(verticalFovDeg(500, 500)).toBeCloseTo(ASSUMED_CAMERA_FOV_DEG, 6);
    expect(tan(verticalFovDeg(W, H) / 2)).toBeCloseTo((tan(ASSUMED_CAMERA_FOV_DEG / 2) * H) / W, 9);
    const view = scene();
    // The projection's x scale is 1 / tan(half the horizontal field of view).
    expect(view.camera.projectionMatrix.elements[0]).toBeCloseTo(1 / tan(ASSUMED_CAMERA_FOV_DEG / 2), 6);
  });

  it('stands AR_CAMERA_HEIGHT_M up; with no live tilt, looks FALLBACK_PITCH_DEG down, unrolled', () => {
    const view = scene();
    expect(view.camera.position.y).toBe(AR_CAMERA_HEIGHT_M);
    const look = lookOf(view);
    expect(Math.asin(-look.y) / DEG).toBeCloseTo(FALLBACK_PITCH_DEG, 6);
    expect(look.z).toBeLessThan(0); // heading 0: north, which is -z
    expect(new Vector3(1, 0, 0).applyQuaternion(view.camera.quaternion).y).toBeCloseTo(0, 9);
  });

  it('with a live tilt, keeps the phone’s real pitch and roll, facing AR Scan’s heading', () => {
    // The phone's own orientation says 100 deg; AR Scan's heading (smoothed, or the GPS
    // course) says 110. The camera faces 110, pitched and rolled exactly as the phone is.
    const tilt = tiltFor(100, -35, 8);
    const q = cameraQuaternion({ heading: 110, tilt });
    expect(headingFromQuaternion(q)).toBeCloseTo(110, 6);
    // Only turned about the vertical: every axis keeps its height, so the pitch (the
    // view's) and the roll (the right edge's) are the phone's own, exactly.
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, -1]]) {
      expect(qRotate(q, axis)[1]).toBeCloseTo(qRotate(tilt.q, axis)[1], 9);
    }
    expect(Math.asin(qRotate(q, [0, 0, -1])[1]) / DEG).toBeCloseTo(-35, 6);
    // And turned by exactly the gap between the two headings.
    const turn = (v) => (Math.atan2(v[0], -v[2]) / DEG + 360) % 360;
    expect(turn(qRotate(q, [0, 0, -1])) - turn(qRotate(tilt.q, [0, 0, -1]))).toBeCloseTo(110 - tilt.heading, 6);
  });

  it('uses the fallback only when there is no live tilt', () => {
    const pitchDown = (tilt) => Math.asin(-qRotate(cameraQuaternion({ heading: 0, tilt }), [0, 0, -1])[1]) / DEG;
    expect(pitchDown(tiltFor(0, -50, 0))).toBeCloseTo(50, 6);
    expect(pitchDown(tiltFor(0, 0, 0))).toBeCloseTo(0, 6); // a real level phone is not the fallback
    expect(pitchDown(null)).toBeCloseTo(FALLBACK_PITCH_DEG, 6);
  });

  it('turns with the heading: facing east shows an eastward road as facing north shows a northward one', () => {
    const north = scene(0);
    const east = scene(90);
    for (const d of [3, 20, 80]) {
      const a = screenOf(north, 0.5, -d);
      const b = screenOf(east, d, 0.5);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
    }
  });
});

describe('projectGroundPoint', () => {
  // The ground point `north` m north and `east` m east of START, through the camera.
  const project = (tilt, heading, north, east = 0) =>
    projectGroundPoint({ q: cameraQuaternion({ heading, tilt }), width: W, height: H, origin: START, ...pt(north, east) });
  const world = (north, east) => ({
    x: (pt(north, east).lng - START.lng) * DEG * 6371e3 * Math.cos(START.lat * DEG),
    z: -(pt(north, east).lat - START.lat) * DEG * 6371e3,
  });

  it('puts a ground point exactly where the three.js camera does, tilted and rolled too', () => {
    for (const tilt of TILTS) {
      for (const heading of [0, 25]) {
        const view = scene(heading, tilt);
        let seen = 0;
        for (const [n, e] of [[5, 0], [15, 3], [40, -12], [120, 30], [300, -40], [3, 1], [-20, 0]]) {
          const p = project(tilt, heading, n, e);
          const { x, z } = world(n, e);
          const s = screenOf(view, x, z);
          const ahead = new Vector3(x, 0, z).sub(view.camera.position).dot(lookOf(view)) > 0.1;
          if (!(ahead && s.x > 0 && s.x < W && s.y > 0 && s.y < H)) {
            expect(p).toBeNull();
            continue;
          }
          seen += 1;
          expect(p.x * W).toBeCloseTo(s.x, 4);
          expect(p.y * H).toBeCloseTo(s.y, 4);
        }
        expect(seen).toBeGreaterThan(0);
      }
    }
  });

  it('is null behind the camera', () => {
    expect(project(null, 0, -30)).toBeNull();
    expect(project(null, 180, 30)).toBeNull();
  });

  it('places the destination’s tag through the camera, on the road’s end', () => {
    const q = cameraQuaternion({ heading: 0, tilt: tiltFor(10, -25, 6) });
    const targetProject = (lat, lng) => projectGroundPoint({ q, width: W, height: H, origin: START, lat, lng });
    const target = { name: 'RALLY', ...pt(80, 20) };
    const { target: tag } = selectArTags({ origin: START, heading: 0, target, screenWidth: W, screenHeight: H, targetProject });
    const at = targetProject(target.lat, target.lng);
    expect(tag.x).toBeCloseTo(at.x * W, 9);
    expect(tag.y).toBeCloseTo(at.y * H, 9);
    expect(tag.distance).toBeGreaterThan(80);
    const behind = selectArTags({ origin: START, heading: 0, target: { name: 'B', ...pt(-80) }, screenWidth: W, screenHeight: H, targetProject });
    expect(behind.target).toBeNull();
  });

  it('with no live tilt, rises toward a horizon FALLBACK_PITCH_DEG above mid-screen', () => {
    const horizon = 0.5 - (0.5 * tan(FALLBACK_PITCH_DEG)) / tan(verticalFovDeg(W, H) / 2);
    const y = (n) => project(null, 0, n).y;
    expect(y(5)).toBeGreaterThan(y(20));
    expect(y(20)).toBeGreaterThan(y(150));
    expect(y(1e5)).toBeCloseTo(horizon, 4);
  });

  it('follows the real pitch: tip the phone up and the road drops down the screen', () => {
    const y = (pitch) => project(tiltFor(0, pitch, 0), 0, 30).y;
    expect(y(-10)).toBeGreaterThan(y(-20));
    expect(y(-20)).toBeGreaterThan(y(-30));
  });
});

describe('the phone held upright (beta near 90), through the camera', () => {
  it('small gamma changes move the road smoothly on screen, with no jumps', () => {
    // As useDeviceHeading reports it: heading and tilt from the same orientation.
    for (const beta of [80, 89, 90, 91]) {
      let prev = null;
      for (let gamma = -3; gamma <= 3.0001; gamma += 0.1) {
        const q = deviceQuaternion(10, beta, gamma);
        const heading = headingFromQuaternion(q);
        const p = projectGroundPoint({ q: cameraQuaternion({ heading, tilt: { q, heading } }), width: W, height: H, origin: START, ...pt(40, 0) });
        expect(p).not.toBeNull();
        if (prev) {
          // A 0.1 deg step can move a point on screen by about a pixel at most.
          expect(Math.abs(p.x - prev.x) * W).toBeLessThan(1);
          expect(Math.abs(p.y - prev.y) * H).toBeLessThan(1);
        }
        prev = p;
      }
    }
  });
});

describe('buildRoadStrip', () => {
  const PATH = [pt(0), pt(60), pt(60, 40), pt(200, 40)];

  it('is null with nothing to draw', () => {
    expect(buildRoadStrip([], START)).toBeNull();
    expect(buildRoadStrip(remainingRouteSamples([pt(0)], START), START)).toBeNull();
    expect(buildRoadStrip(remainingRouteSamples(PATH, START), null)).toBeNull();
  });

  it('uses exactly Stage 3’s remaining, resampled, capped route', () => {
    const samples = remainingRouteSamples(PATH, pt(10, 2));
    expect(samples).toEqual(resamplePath(remainingPath(PATH, pt(10, 2))));
    expect(pairs(buildRoadStrip(samples, pt(10, 2)))).toHaveLength(samples.length);
    expect(samples.at(-1).along).toBe(ROAD_LINE_MAX_DISTANCE_METERS);
  });

  it('is one real-world width all along, flat on the ground, centred on the route', () => {
    const strip = stripFor(PATH);
    const samples = remainingRouteSamples(PATH, START);
    pairs(strip).forEach(([l, r], k) => {
      expect(l.distanceTo(r)).toBeCloseTo(ROAD_LINE_WORLD_WIDTH_M, 6);
      expect(l.y).toBe(0);
      expect(r.y).toBe(0);
      const mid = l.clone().add(r).multiplyScalar(0.5);
      const s = samples[k];
      const want = { x: ((s.lng - START.lng) * Math.PI / 180) * 6371e3 * Math.cos((START.lat * Math.PI) / 180), z: -((s.lat - START.lat) * Math.PI / 180) * 6371e3 };
      expect(mid.x).toBeCloseTo(want.x, 6);
      expect(mid.z).toBeCloseTo(want.z, 6);
    });
  });

  it('has left on the left: walking north, the left edge is to the west', () => {
    const [[l, r]] = pairs(stripFor([pt(0), pt(100)]));
    expect(l.x).toBeLessThan(r.x);
  });

  it('fades from solid at your feet to faint at the draw limit, as the Stage 3 ribbon does', () => {
    const strip = stripFor([pt(0), pt(400)]);
    expect(strip.alphas[0]).toBeCloseTo(ROAD_LINE_NEAR_OPACITY, 9);
    expect(strip.alphas.at(-1)).toBeCloseTo(ROAD_LINE_FAR_OPACITY, 9);
    for (let i = 2; i < strip.alphas.length; i += 2) expect(strip.alphas[i]).toBeLessThan(strip.alphas[i - 2]);
  });

  it('joins consecutive pairs with two triangles each', () => {
    const strip = stripFor([pt(0), pt(20)]);
    const n = strip.positions.length / 6;
    expect(strip.indices).toHaveLength((n - 1) * 6);
    expect(Math.max(...strip.indices)).toBe(2 * n - 1);
  });

  it('shortens as it is walked, recomputed from the position alone', () => {
    const path = [pt(0), pt(100)];
    const lengthLeft = (where) => pairs(stripFor(path, where)).length;
    expect(lengthLeft(pt(40))).toBeLessThan(lengthLeft(pt(0)));
    expect(lengthLeft(pt(80))).toBeLessThan(lengthLeft(pt(40)));
  });
});

describe('the road seen through the camera', () => {
  it('narrows into the distance by perspective alone: on-screen width is the world width over depth', () => {
    const view = scene(0);
    const strip = stripFor([pt(0), pt(200)]);
    const widths = pairs(strip)
      .map(([l, r]) => ({ l: screenOf(view, l.x, l.z), r: screenOf(view, r.x, r.z), z: l.z }))
      .filter(({ z }) => -z > 3); // under your feet is below the screen
    for (let k = 1; k < widths.length; k++) {
      expect(widths[k].r.x - widths[k].l.x).toBeLessThan(widths[k - 1].r.x - widths[k - 1].l.x);
    }
    const pitch = FALLBACK_PITCH_DEG * DEG;
    for (const { l, r, z } of widths) {
      const depth = AR_CAMERA_HEIGHT_M * Math.sin(pitch) + -z * Math.cos(pitch);
      const expected = (ROAD_LINE_WORLD_WIDTH_M / (depth * tan(ASSUMED_CAMERA_FOV_DEG / 2))) * (W / 2);
      expect(r.x - l.x).toBeCloseTo(expected, 4);
    }
  });

  it('draws in the app’s tactical red, fading by vertex alpha', () => {
    const view = scene(0);
    view.setRoad(stripFor([pt(0), pt(100)]));
    const { geometry, material } = view.road;
    const color = geometry.getAttribute('color');
    expect(color.itemSize).toBe(4);
    expect([color.getX(0), color.getY(0), color.getZ(0)].map((c) => Math.round(c * 255))).toEqual([0xef, 0x44, 0x44]);
    expect(color.getW(0)).toBeCloseTo(ROAD_LINE_NEAR_OPACITY, 6);
    expect(material.vertexColors).toBe(true);
    expect(material.transparent).toBe(true);
  });

  it('replaces the road outright on every update, freeing the old one', () => {
    const view = scene(0);
    view.setRoad(stripFor([pt(0), pt(100)]));
    const first = view.road;
    let freed = false;
    first.geometry.addEventListener('dispose', () => { freed = true; });
    view.setRoad(stripFor([pt(0), pt(100)], pt(50)));
    expect(view.road).not.toBe(first);
    expect(freed).toBe(true);
    expect(view.scene.children.filter((c) => c.isMesh)).toHaveLength(1);
    view.setRoad(null);
    expect(view.road).toBeNull();
    expect(view.scene.children.filter((c) => c.isMesh)).toHaveLength(0);
  });
});
