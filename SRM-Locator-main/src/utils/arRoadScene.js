import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { AR_ASSUMED_PITCH_DEG, AR_CAMERA_HEIGHT_M, verticalFovDeg } from './arCamera';

// AR Scan's 'realistic' road line: the route to the Rally Point as a flat strip on the
// ground, seen through a camera modelled in metres (arCamera.js). Loaded with a dynamic
// import() by ARRoadGL only in 'realistic' mode, like the arrow's scene, and sharing its
// three.js download.
//
// Nothing here fakes perspective: the strip is one real-world width all along
// (buildRoadStrip) and the camera narrows it into the distance.

// The app's tactical red (Tailwind red-500), as the Stage 3 ribbon uses.
const ROAD_COLOR = [0xef / 255, 0x44 / 255, 0x44 / 255];

// The strip from buildRoadStrip as a mesh geometry, with each vertex's fade as the
// alpha of its colour.
export const buildRoadGeometry = (strip) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(strip.positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(strip.alphas.flatMap((a) => [...ROAD_COLOR, a]), 4));
  geometry.setIndex(strip.indices);
  return geometry;
};

/**
 * The scene without a renderer, so it can be tested with no WebGL. Returns the scene,
 * the camera and:
 *   setRoad(strip): the strip to draw (buildRoadStrip), or null for none. Replaces the
 *     last one outright; nothing about the route is kept between calls.
 *   setHeading(deg): where the phone points, clockwise from north
 *   setView({ width, height }): the screen size
 */
export const buildRoadScene = () => {
  const scene = new Scene();
  const material = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  let mesh = null;

  // Standing at the origin, eyes AR_CAMERA_HEIGHT_M up. Turned by the heading first, then
  // tipped down by the pitch, so the pitch is always about the phone's own left-right.
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, AR_CAMERA_HEIGHT_M, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.x = (-AR_ASSUMED_PITCH_DEG * Math.PI) / 180;

  const clearRoad = () => {
    if (!mesh) return;
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh = null;
  };

  return {
    scene,
    camera,
    get road() {
      return mesh;
    },
    setRoad: (strip) => {
      clearRoad();
      if (!strip) return;
      mesh = new Mesh(buildRoadGeometry(strip), material);
      scene.add(mesh);
    },
    // three.js looks down -z (north here); turning clockwise on the ground is a negative
    // turn about y.
    setHeading: (deg) => {
      camera.rotation.y = (-deg * Math.PI) / 180;
    },
    setView: ({ width, height }) => {
      camera.fov = verticalFovDeg(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    dispose: () => {
      clearRoad();
      material.dispose();
    },
  };
};

/**
 * The live road, drawing into `canvas` with a transparent background. Throws when WebGL
 * isn't available (the caller keeps the Stage 3 ribbon). render() draws a frame;
 * dispose() frees the geometry, material and the WebGL context itself.
 */
export const createRoadView = (canvas) => {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const view = buildRoadScene();
  return {
    setRoad: view.setRoad,
    setHeading: view.setHeading,
    setView: ({ width, height, pixelRatio = 1 }) => {
      renderer.setPixelRatio(Math.min(pixelRatio, 2));
      renderer.setSize(width, height, false);
      view.setView({ width, height });
    },
    render: () => renderer.render(view.scene, view.camera),
    dispose: () => {
      view.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
};
