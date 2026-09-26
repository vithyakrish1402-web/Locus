import { ASSUMED_CAMERA_FOV_DEG } from './arTags';
import { toLocalMeters } from './arRoadLine';
import { qConjugate, qFromAxisAngle, qFromEulerYXZ, qMultiply, qRotate } from './deviceOrientation';

// AR Scan's 'realistic' world camera: the phone camera modelled as a real lens in metres,
// which the three.js road (arRoadScene.js) is drawn through. Pure, so the road's
// placement and the destination tag that sits on it share one camera, tested without
// WebGL. (The three.js arrow has a camera of its own, in CSS pixels, that copies the CSS
// arrow; it has nothing to do with this one.)
//
// World axes are three.js's: x east, y up, z south (north is -z), metres from the phone.

// How high the phone is held above the ground. Rough, to be tuned on a phone.
export const AR_CAMERA_HEIGHT_M = 1.4;

// How far below level the camera is taken to point when there is no live tilt: the
// device never sent beta and gamma (a desktop, an old phone, a denied permission). Only
// then; with a live tilt the phone's real orientation is used.
export const FALLBACK_PITCH_DEG = 20;

const rad = (deg) => (deg * Math.PI) / 180;

// three.js takes a vertical field of view; ASSUMED_CAMERA_FOV_DEG is horizontal. For a
// screen `width` by `height`, the vertical one that sees the same horizontal span.
export const verticalFovDeg = (width, height, horizontalFovDeg = ASSUMED_CAMERA_FOV_DEG) =>
  (2 * Math.atan((Math.tan(rad(horizontalFovDeg) / 2) * height) / width) * 180) / Math.PI;

/**
 * The world camera's orientation, as a quaternion [x, y, z, w]. `heading` is AR Scan's
 * heading (the one the arrow and the tags use: the smoothed compass, or the GPS course
 * while walking). `tilt` is useDeviceHeading's ({ q, heading }), or null when there is no
 * live tilt.
 *
 * With a tilt, it is the phone's own orientation turned about the vertical by however far
 * AR Scan's heading is from the orientation's own, so the road faces where the tags do
 * and keeps the phone's real pitch and roll. One quaternion product: no angles are split
 * out and put back together, so nothing jumps when the phone is upright.
 * Without one, the camera faces `heading`, FALLBACK_PITCH_DEG down, with no roll.
 */
export const cameraQuaternion = ({ heading, tilt }) => {
  if (tilt && Array.isArray(tilt.q) && Number.isFinite(tilt.heading)) {
    // Clockwise on the ground is a negative turn about three.js's y.
    return qMultiply(qFromAxisAngle([0, 1, 0], -rad(heading - tilt.heading)), tilt.q);
  }
  return qFromEulerYXZ(-rad(FALLBACK_PITCH_DEG), -rad(heading), 0);
};

/**
 * Where a point on the ground at (`lat`, `lng`) lands on screen through the world camera
 * oriented `q`, standing at `origin`: { x, y } as fractions of the screen's width and
 * height, or null when it is behind the camera or off the screen. The same projection
 * three.js applies to the road, so AR Scan's destination tag sits on the road's end.
 */
export const projectGroundPoint = ({ q, width, height, origin, lat, lng, horizontalFovDeg = ASSUMED_CAMERA_FOV_DEG }) => {
  const { x: east, y: north } = toLocalMeters(origin, { lat, lng });
  const [cx, cy, cz] = qRotate(qConjugate(q), [east, -AR_CAMERA_HEIGHT_M, -north]);
  const depth = -cz;
  if (!(depth > 0.1)) return null;
  const tanH = Math.tan(rad(horizontalFovDeg) / 2);
  const tanV = Math.tan(rad(verticalFovDeg(width, height, horizontalFovDeg)) / 2);
  const x = (1 + cx / (depth * tanH)) / 2;
  const y = (1 - cy / (depth * tanV)) / 2;
  if (!(x > 0 && x < 1 && y > 0 && y < 1)) return null;
  return { x, y };
};
