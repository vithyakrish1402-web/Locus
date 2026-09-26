// AR Scan Stage 5b: the 'realistic' road line, a real-world strip on the ground seen
// through a camera in metres. Tested without WebGL (three.js's maths runs anywhere).
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
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
import { AR_ASSUMED_PITCH_DEG, AR_CAMERA_HEIGHT_M, groundScreenYFor, verticalFovDeg } from '../src/utils/arCamera.js';
import { ASSUMED_CAMERA_FOV_DEG, selectArTags } from '../src/utils/arTags.js';
import { angularDifference, calculateBearing } from '../src/utils/geoMath.js';
import { haversineMeters } from '../src/utils/walkingRoute.js';

const START = { lat: 12.8230, lng: 80.0440 };
const pt = (north, east = 0) => ({
  lat: START.lat + north / 111320,
  lng: START.lng + east / (111320 * Math.cos((START.lat * Math.PI) / 180)),
});
const W = 400;
const H = 800;
const tan = (deg) => Math.tan((deg * Math.PI) / 180);

const scene = (heading = 0) => {
  const view = buildRoadScene();
  view.setView({ width: W, height: H });
  view.setHeading(heading);
  view.camera.updateMatrixWorld(true);
  return view;
};
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

  it('stands AR_CAMERA_HEIGHT_M up, looking AR_ASSUMED_PITCH_DEG down', () => {
    const view = scene();
    expect(view.camera.position.y).toBe(AR_CAMERA_HEIGHT_M);
    const look = new Vector3();
    view.camera.getWorldDirection(look);
    expect((Math.asin(-look.y) * 180) / Math.PI).toBeCloseTo(AR_ASSUMED_PITCH_DEG, 6);
    expect(look.z).toBeLessThan(0); // heading 0: north, which is -z
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

describe('groundScreenYFor', () => {
  it('puts a ground point exactly where the three.js camera does, ahead and off to the side', () => {
    const view = scene(0);
    const yFor = groundScreenYFor({ width: W, height: H });
    for (const d of [2, 5, 15, 60, 150, 400]) {
      for (const angle of [0, -20, 25]) {
        const r = (angle * Math.PI) / 180;
        const { y } = screenOf(view, d * Math.sin(r), -d * Math.cos(r));
        expect(yFor(d, angle) * H).toBeCloseTo(y, 6);
      }
    }
  });

  it('places the destination’s tag on the ground under the world camera, off to the side too', () => {
    const yFor = groundScreenYFor({ width: W, height: H });
    const target = { name: 'RALLY', ...pt(80, 30) }; // about 20 deg right of north
    const { target: tag } = selectArTags({ origin: START, heading: 0, target, screenWidth: W, screenHeight: H, targetScreenYFor: yFor });
    const angle = angularDifference(calculateBearing(START.lat, START.lng, target.lat, target.lng), 0);
    expect(angle).toBeGreaterThan(15);
    // The same point on the ground as the three.js camera sees it.
    const { y } = screenOf(scene(0), 30, -80);
    expect(tag.y).toBeCloseTo(yFor(haversineMeters(START, target), angle) * H, 6);
    expect(tag.y).toBeCloseTo(y, 1);
  });

  it('rises toward a horizon above mid-screen, since the phone is pitched down', () => {
    const yFor = groundScreenYFor({ width: W, height: H });
    const horizon = 0.5 - (0.5 * tan(AR_ASSUMED_PITCH_DEG)) / tan(verticalFovDeg(W, H) / 2);
    expect(yFor(5)).toBeGreaterThan(yFor(20));
    expect(yFor(20)).toBeGreaterThan(yFor(150));
    expect(yFor(1e6)).toBeCloseTo(horizon, 4);
    expect(horizon).toBeLessThan(0.5);
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
    const pitch = (AR_ASSUMED_PITCH_DEG * Math.PI) / 180;
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
