// The phone's orientation as a quaternion, and what AR Scan reads from it: which way the
// camera faces and how it is tilted. Pure, and free of three.js (the compass hook that
// uses it is in the main bundle, and three.js must stay a lazy download).
//
// Why a quaternion: a phone held upright, as for AR Scan, has `beta` near 90 deg, which
// is where the event's Z-X'-Y'' angles lock up (gimbal lock). There, a degree of roll
// swings `alpha` and `gamma` by tens of degrees in opposite directions, so reading any
// one of them alone (a heading from `360 - alpha`, a pitch from `beta`) jumps. The
// orientation they describe together does not, and a quaternion built from all three is
// smooth through that posture.
//
// Quaternions are [x, y, z, w], in three.js's world axes: x east, y up, z south.

const DEG = Math.PI / 180;
const HALF_SQRT = Math.sqrt(0.5);

export const qMultiply = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  ax * bw + aw * bx + ay * bz - az * by,
  ay * bw + aw * by + az * bx - ax * bz,
  az * bw + aw * bz + ax * by - ay * bx,
  aw * bw - ax * bx - ay * by - az * bz,
];

export const qFromAxisAngle = ([x, y, z], angle) => {
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
};

// Euler angles in three.js's 'YXZ' order (turn about y, then x, then z), as
// Quaternion.setFromEuler does it.
export const qFromEulerYXZ = (x, y, z) => {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
};

export const qNormalize = (q) => {
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
};

// Vector `v` turned by unit quaternion `q`.
export const qRotate = ([qx, qy, qz, qw], [vx, vy, vz]) => {
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
};

export const qConjugate = ([x, y, z, w]) => [-x, -y, -z, w];

// The angle, in degrees, between two orientations.
export const qAngleDeg = (a, b) => {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return (2 * Math.acos(Math.min(dot, 1))) / DEG;
};

/**
 * The camera's orientation for a deviceorientation event, as three.js's
 * DeviceOrientationControls example computed it: the event's angles as intrinsic
 * Z-X'-Y'' (three.js's 'YXZ' with beta, alpha, -gamma), then -90 deg about x so the
 * camera looks out of the back of the phone rather than out of its top, then the
 * screen's own rotation (`screenAngleDeg`, screen.orientation.angle), so a landscape
 * screen's up is the camera's up.
 */
export const deviceQuaternion = (alphaDeg, betaDeg, gammaDeg, screenAngleDeg = 0) => {
  const q = qFromEulerYXZ(betaDeg * DEG, alphaDeg * DEG, -gammaDeg * DEG);
  const backNotTop = [-HALF_SQRT, 0, 0, HALF_SQRT];
  return qMultiply(qMultiply(q, backNotTop), qFromAxisAngle([0, 0, 1], -screenAngleDeg * DEG));
};

/**
 * Which way the phone faces, as a compass heading (degrees clockwise from north), from
 * its camera orientation `q`. Held up, that is where the camera looks; lying flat, where
 * the top of the screen points (what `360 - alpha` gives). In between, the two blend by
 * how steeply the camera points down or up, so there is no jump and no posture where it
 * is undefined: when the camera looks straight down, the top of the screen is level.
 */
export const headingFromQuaternion = (q) => {
  const f = qRotate(q, [0, 0, -1]);
  const u = qRotate(q, [0, 1, 0]);
  const s = f[1] * f[1];
  const x = f[0] + u[0] * s;
  const z = f[2] + u[2] * s;
  return ((Math.atan2(x, -z) / DEG) % 360 + 360) % 360;
};

// One step of an exponential moving average of orientations: `prev` moved `alpha` of the
// way toward `next` (taking the nearer of next's two equal forms), renormalised. Null
// `prev` takes `next` as-is.
export const smoothQuaternion = (prev, next, alpha) => {
  if (!prev) return next;
  const dot = prev[0] * next[0] + prev[1] * next[1] + prev[2] * next[2] + prev[3] * next[3];
  const n = dot < 0 ? next.map((v) => -v) : next;
  return qNormalize(prev.map((p, i) => p + alpha * (n[i] - p)));
};

// The screen's rotation in degrees (0 portrait, 90 or 270 landscape).
export const currentScreenAngle = () => {
  if (typeof window === 'undefined') return 0;
  const angle = window.screen?.orientation?.angle ?? window.orientation ?? 0;
  return Number.isFinite(angle) ? angle : 0;
};
