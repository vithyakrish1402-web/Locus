import { ASSUMED_CAMERA_FOV_DEG } from './arTags';

// AR Scan's 'realistic' world camera: the phone camera modelled as a real lens in metres,
// which the three.js road (arRoadScene.js) is drawn through. Pure, so the road's
// placement and the destination tag that sits on it share one formula, tested without
// WebGL. (The three.js arrow has a camera of its own, in CSS pixels, that copies the CSS
// arrow; it has nothing to do with this one.)

// How high the phone is held above the ground. Rough, to be tuned on a phone.
export const AR_CAMERA_HEIGHT_M = 1.4;

// TEMPORARY — deleted once Stage 5c reads real device pitch.
// How far below level the phone is assumed to point. Nothing reads the phone's tilt yet,
// and a level camera puts the horizon mid-screen, squeezing the whole road into a strip
// behind the arrow ring. 20 deg down puts the horizon where Stage 3's hand-fitted curve
// has it. This is a stand-in, not a tuning knob: Stage 5c must delete it and use the
// sensor, not keep it as a fallback or an offset beside the real reading.
export const AR_ASSUMED_PITCH_DEG = 20;

const rad = (deg) => (deg * Math.PI) / 180;

// three.js takes a vertical field of view; ASSUMED_CAMERA_FOV_DEG is horizontal. For a
// screen `width` by `height`, the vertical one that sees the same horizontal span.
export const verticalFovDeg = (width, height, horizontalFovDeg = ASSUMED_CAMERA_FOV_DEG) =>
  (2 * Math.atan((Math.tan(rad(horizontalFovDeg) / 2) * height) / width) * 180) / Math.PI;

/**
 * Where a point on the ground lands vertically, seen through the world camera, as a
 * fraction of screen height (0 top, 1 bottom). Returns `(distance, angle)`: `distance`
 * metres away, `angle` degrees off to the side of where the phone points. Only the part
 * of the distance straight ahead counts (a pitched camera's height on screen depends on
 * that alone), so it matches where the three.js road puts the same point exactly.
 * This is the shape projectPoint's `screenYFor` takes.
 */
export const groundScreenYFor = ({ width, height, horizontalFovDeg = ASSUMED_CAMERA_FOV_DEG }) => {
  const tanHalfV = Math.tan(rad(verticalFovDeg(width, height, horizontalFovDeg)) / 2);
  const pitch = rad(AR_ASSUMED_PITCH_DEG);
  const h = AR_CAMERA_HEIGHT_M;
  return (distance, angle = 0) => {
    const forward = Math.max(distance, 0) * Math.cos(rad(angle));
    // The camera looks down `pitch`; `depth` is along its view, `up` up its screen.
    const depth = h * Math.sin(pitch) + forward * Math.cos(pitch);
    const up = -h * Math.cos(pitch) + forward * Math.sin(pitch);
    return 0.5 - (0.5 * up) / (depth * tanHalfV);
  };
};
