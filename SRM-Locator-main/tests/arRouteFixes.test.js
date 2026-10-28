// AR Scan's road: not drawn for the offline campus route (straight lines through buildings), and
// drawn with the view's real field of view, so a "realistic" road is as wide as it really is.
import { describe, it, expect, vi } from 'vitest';
import { arRoutePathFor } from '../src/utils/arRoadLine.js';
import { verticalFovDeg } from '../src/utils/arCamera.js';

// WebGL stood in for: what each frame was drawn with.
const drawn = vi.hoisted(() => ({ camera: null }));
vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal()),
  WebGLRenderer: class {
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render(_scene, camera) { drawn.camera = camera; }
    dispose() {}
    forceContextLoss() {}
  },
}));

const DEST = { lat: 12.8233, lng: 80.0444 };
const path = [{ lat: 12.8246, lng: 80.0453 }, DEST];

describe('arRoutePathFor', () => {
  it('draws a real online route', () => {
    const route = { isRealRoute: true, path };
    expect(arRoutePathFor(DEST, { personalTarget: DEST, personalRoute: route })).toBe(path);
  });

  it('draws nothing for the offline campus route', () => {
    const route = { isRealRoute: true, path, fromCampusGraph: true };
    expect(arRoutePathFor(DEST, { personalTarget: DEST, personalRoute: route })).toBeNull();
  });
});

describe('createRoadView().setView', () => {
  it('uses the field of view it is given, not the assumed default', async () => {
    const { createRoadView } = await import('../src/utils/arRoadScene.js');
    const view = createRoadView({});
    view.setView({ width: 400, height: 800, horizontalFovDeg: 66 });
    view.render();
    expect(drawn.camera.fov).toBeCloseTo(verticalFovDeg(400, 800, 66), 6);
    expect(drawn.camera.fov).not.toBeCloseTo(verticalFovDeg(400, 800), 1);
  });
});
