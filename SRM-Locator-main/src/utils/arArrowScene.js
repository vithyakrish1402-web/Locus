import {
  AmbientLight,
  BufferGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  WebGLRenderer,
} from 'three';
import { ARROW_BASE_TILT_DEG, ARROW_PERSPECTIVE_PX, ARROW_THICKNESS_PX } from '../components/ARArrow3D';

// AR Scan's 'realistic' arrow, rendered with three.js. Everything three.js is in this one
// module, which ARArrowGL loads with a dynamic import() only in 'realistic' mode, so no
// other mode ever downloads it.
//
// It points exactly like the CSS arrow (ARArrow3D) because it copies that arrow's
// geometry: the same outline and size, the same ground plane tilted back
// ARROW_BASE_TILT_DEG, and a camera ARROW_PERSPECTIVE_PX in front of the ring's centre
// with 1 unit = 1 CSS pixel, which is what CSS `perspective` does. What differs is the
// rendering: a solid mesh with a raised ridge, lit by a light that stays put while the
// arrow turns under it.

// The CSS arrow's outline (its SVG viewBox is 0-100, drawn in a 160 px box), pointing up.
const BOX_PX = 160;
const SVG_POINTS = { tip: [50, 10], right: [86, 74], notch: [50, 58], left: [14, 74] };
const toScene = ([sx, sy]) => [((sx - 50) * BOX_PX) / 100, ((50 - sy) * BOX_PX) / 100];
export const ARROW_OUTLINE = Object.fromEntries(Object.entries(SVG_POINTS).map(([k, p]) => [k, toScene(p)]));

// How far the ridge from tip to notch rises above the wings' top edge. High enough that
// the two top faces lean well apart, so the light catches one and not the other.
export const ARROW_RIDGE_PX = 12;

const TOP_COLOR = 0xf04848;
const SIDE_COLOR = 0x6b1515;
const EDGE_COLOR = 0xfca5a5;

// A soft round shadow for the ground under the arrow: black, fading out from the middle.
const SHADOW_TEXTURE_PX = 64;
const buildShadowTexture = () => {
  const n = SHADOW_TEXTURE_PX;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - (n - 1) / 2, y - (n - 1) / 2) / (n / 2);
      data[(y * n + x) * 4 + 3] = Math.round(255 * Math.max(0, 1 - d) ** 2);
    }
  }
  const texture = new DataTexture(data, n, n, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
};

// A wedge: the outline extruded ARROW_THICKNESS_PX up from the ground, with its top
// folded along the centre line into two faces meeting at a raised ridge. Unshared
// vertices, so each face is flat-shaded. Group 0 is the top, group 1 the sides and base.
export const buildArrowGeometry = () => {
  const { tip, right, notch, left } = ARROW_OUTLINE;
  const T = ARROW_THICKNESS_PX;
  const R = ARROW_RIDGE_PX;
  const up = ([x, y], z) => [x, y, z];
  const topTip = up(tip, T + R);
  const topNotch = up(notch, T + R);
  const topLeft = up(left, T);
  const topRight = up(right, T);
  const tri = (...pts) => pts.flat();

  const top = [...tri(topTip, topNotch, topLeft), ...tri(topTip, topRight, topNotch)];
  const ring = [
    [tip, T + R],
    [right, T],
    [notch, T + R],
    [left, T],
  ];
  const sides = [];
  for (let i = 0; i < ring.length; i++) {
    const [a, ha] = ring[i];
    const [b, hb] = ring[(i + 1) % ring.length];
    sides.push(...tri(up(a, 0), up(b, 0), up(b, hb)), ...tri(up(a, 0), up(b, hb), up(a, ha)));
  }
  const base = [...tri(up(tip, 0), up(left, 0), up(notch, 0)), ...tri(up(tip, 0), up(notch, 0), up(right, 0))];

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([...top, ...sides, ...base], 3));
  geometry.computeVertexNormals();
  geometry.addGroup(0, top.length / 3, 0);
  geometry.addGroup(top.length / 3, (sides.length + base.length) / 3, 1);
  return geometry;
};

/**
 * The scene without a renderer, so its geometry can be tested with no WebGL. Returns the
 * scene, camera, and the arrow mesh, plus:
 *   setRotation(deg): AR Scan's wraparound-safe angle, clockwise as seen on screen
 *   setView({ width, height, cx, cy }): the screen size and where the ring's centre is
 */
export const buildArrowScene = () => {
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 0.3));
  // Fixed in the world, low from the left, so one top face is lit and the other in shade,
  // and which is which changes as the arrow turns under it (the CSS arrow's shading
  // turns with the arrow).
  const sun = new DirectionalLight(0xffffff, 4.2);
  sun.position.set(-1.2, 0.45, 0.9);
  scene.add(sun);

  const geometry = buildArrowGeometry();
  const materials = [
    new MeshStandardMaterial({ color: TOP_COLOR, roughness: 0.35, metalness: 0.05, emissive: 0x1a0303, side: DoubleSide }),
    new MeshStandardMaterial({ color: SIDE_COLOR, roughness: 0.7, metalness: 0.1, side: DoubleSide }),
  ];
  const arrow = new Mesh(geometry, materials);
  // A thin highlight along the creases and outline.
  const edgeGeometry = new EdgesGeometry(geometry, 1);
  const edgeMaterial = new LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.7 });
  arrow.add(new LineSegments(edgeGeometry, edgeMaterial));

  // A soft shadow on the ground under the arrow. It stays put while the arrow turns.
  const shadowTexture = buildShadowTexture();
  const shadowGeometry = new PlaneGeometry(BOX_PX * 0.95, BOX_PX * 0.95);
  const shadowMaterial = new MeshBasicMaterial({ map: shadowTexture, color: 0x000000, transparent: true, opacity: 0.6, depthWrite: false });
  const shadow = new Mesh(shadowGeometry, shadowMaterial);
  shadow.position.z = -0.5;

  // The ground plane, tilted back like the CSS arrow's rotateX. CSS's y runs down the
  // screen and three.js's up, so the same tilt is the opposite sign here.
  const plane = new Group();
  plane.rotation.x = (-ARROW_BASE_TILT_DEG * Math.PI) / 180;
  plane.add(shadow);
  plane.add(arrow);
  scene.add(plane);

  const camera = new PerspectiveCamera(50, 1, 1, 4000);
  camera.position.set(0, 0, ARROW_PERSPECTIVE_PX);
  camera.lookAt(0, 0, 0);

  return {
    scene,
    camera,
    arrow,
    // Clockwise on screen is a negative turn about three.js's z (its y points up).
    setRotation: (deg) => {
      arrow.rotation.z = (-deg * Math.PI) / 180;
    },
    // 1 unit = 1 CSS pixel at the arrow's depth: a camera ARROW_PERSPECTIVE_PX away sees
    // `height` units top to bottom. The view is then shifted so the origin (the arrow's
    // centre) lands on the ring's centre.
    setView: ({ width, height, cx, cy }) => {
      camera.fov = (2 * Math.atan(height / 2 / ARROW_PERSPECTIVE_PX) * 180) / Math.PI;
      camera.aspect = width / height;
      camera.setViewOffset(width, height, width / 2 - cx, height / 2 - cy, width, height);
      camera.updateProjectionMatrix();
    },
    dispose: () => {
      [geometry, edgeGeometry, shadowGeometry].forEach((g) => g.dispose());
      [...materials, edgeMaterial, shadowMaterial].forEach((m) => m.dispose());
      shadowTexture.dispose();
    },
  };
};

/**
 * The live arrow, drawing into `canvas` with a transparent background so the camera feed
 * shows everywhere else. Throws when WebGL isn't available (the caller keeps the CSS
 * arrow). render() draws a frame; dispose() frees the geometry, materials and the WebGL
 * context itself, not waiting for the browser to collect it.
 */
export const createArrowView = (canvas) => {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const view = buildArrowScene();
  return {
    setRotation: view.setRotation,
    setView: ({ width, height, cx, cy, pixelRatio = 1 }) => {
      renderer.setPixelRatio(Math.min(pixelRatio, 2));
      renderer.setSize(width, height, false);
      view.setView({ width, height, cx, cy });
    },
    render: () => renderer.render(view.scene, view.camera),
    dispose: () => {
      view.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
};
