// AR Scan Stage 5a: the three.js arrow's scene, tested without WebGL (three.js's maths runs
// anywhere). It must point exactly as the CSS arrow does for the same angle.
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { buildArrowScene, buildArrowGeometry, ARROW_OUTLINE, ARROW_RIDGE_PX } from '../src/utils/arArrowScene.js';
import { ARROW_BASE_TILT_DEG, ARROW_PERSPECTIVE_PX, ARROW_THICKNESS_PX } from '../src/components/ARArrow3D.jsx';

const W = 400;
const H = 800;

// Where the CSS arrow (ARArrow3D) puts a point of its outline on screen: rotate(deg) in the
// plane, rotateX(tilt), then perspective, about the ring's centre (cx, cy). CSS's y runs down.
const cssScreen = ([x3, y3], deg, cx, cy) => {
  const [x, y] = [x3, -y3]; // scene (y up) -> CSS (y down)
  const a = (deg * Math.PI) / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  const t = (ARROW_BASE_TILT_DEG * Math.PI) / 180;
  const py = ry * Math.cos(t);
  const pz = ry * Math.sin(t);
  const k = ARROW_PERSPECTIVE_PX / (ARROW_PERSPECTIVE_PX - pz);
  return [cx + rx * k, cy + py * k];
};

// Where the three.js arrow puts the same point (on its base, z = 0).
const glScreen = (view, [x, y], deg) => {
  view.setRotation(deg);
  view.arrow.updateMatrixWorld(true);
  const p = view.arrow.localToWorld(new Vector3(x, y, 0)).project(view.camera);
  return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H];
};

describe('the three.js arrow points like the CSS arrow', () => {
  const angles = [0, 20, 45, 90, 135, 180, 225, 270, 315, 450, -90, -725];

  for (const [label, cx, cy] of [['centred', W / 2, H / 2], ['ring off-centre', 170, 330]]) {
    it(`matches it point for point at every angle (${label})`, () => {
      const view = buildArrowScene();
      view.setView({ width: W, height: H, cx, cy });
      for (const deg of angles) {
        for (const corner of Object.values(ARROW_OUTLINE)) {
          const [gx, gy] = glScreen(view, corner, deg);
          const [sx, sy] = cssScreen(corner, deg, cx, cy);
          expect(gx).toBeCloseTo(sx, 3);
          expect(gy).toBeCloseTo(sy, 3);
        }
      }
    });
  }

  it('puts the arrow’s centre on the ring’s centre', () => {
    const view = buildArrowScene();
    view.setView({ width: W, height: H, cx: 123, cy: 456 });
    expect(glScreen(view, [0, 0], 37)).toEqual([expect.closeTo(123, 3), expect.closeTo(456, 3)]);
  });
});

describe('the three.js arrow’s shape', () => {
  it('is a solid wedge: a two-face top with a raised ridge, over sides and a base', () => {
    const g = buildArrowGeometry();
    const pos = g.getAttribute('position');
    const zs = Array.from({ length: pos.count }, (_, i) => pos.getZ(i));
    expect(Math.min(...zs)).toBe(0);
    expect(Math.max(...zs)).toBe(ARROW_THICKNESS_PX + ARROW_RIDGE_PX);
    expect(g.groups).toHaveLength(2);
    const [top, rest] = g.groups;
    expect(top).toMatchObject({ start: 0, count: 6, materialIndex: 0 }); // two triangles
    expect(rest.materialIndex).toBe(1);
    expect(top.count + rest.count).toBe(pos.count);
    // The two top faces lean opposite ways, so light catches them differently.
    const n = g.getAttribute('normal');
    const nx = (i) => n.getX(i);
    expect(Math.abs(nx(0))).toBeGreaterThan(0.1);
    expect(nx(0) * nx(3)).toBeLessThan(0);
  });

  it('has an ambient and a directional light', () => {
    const types = buildArrowScene().scene.children.map((c) => c.type);
    expect(types).toContain('AmbientLight');
    expect(types).toContain('DirectionalLight');
  });
});
