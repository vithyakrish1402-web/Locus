// AR Scan Stage 5c: the phone's orientation as a quaternion. Checked against three.js's
// own maths (the DeviceOrientationControls recipe), and directly in the posture where
// reading the event's angles one at a time breaks: the phone held upright.
import { describe, it, expect } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import {
  deviceQuaternion,
  headingFromQuaternion,
  qAngleDeg,
  qRotate,
  smoothQuaternion,
} from '../src/utils/deviceOrientation.js';

const DEG = Math.PI / 180;

// three.js's DeviceOrientationControls.setObjectQuaternion, verbatim in three.js types.
const reference = (alpha, beta, gamma, orient) => {
  const q = new Quaternion().setFromEuler(new Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ'));
  q.multiply(new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -orient * DEG));
  return [q.x, q.y, q.z, q.w];
};

// The W3C event angles for a phone whose camera faces `heading` (clockwise from north),
// tilted `pitch` up from level and rolled `roll` clockwise about the view: the Z-X'-Y''
// decomposition a browser reports, with beta in [-180, 180) and gamma in [-90, 90), so
// it jumps where the real phone doesn't. Built from three.js types, independent of the
// module under test.
const eventFor = (heading, pitch, roll) => {
  // The camera looks out of the phone's back (device -z) with the phone's top (device y)
  // as its up, and device x as its right.
  const cam = new Quaternion().setFromEuler(new Euler(pitch * DEG, -heading * DEG, -roll * DEG, 'YXZ'));
  const at = (x, y, z) => new Vector3(x, y, z).applyQuaternion(cam);
  return eventForDevice(at(1, 0, 0), at(0, 1, 0), at(0, 0, 1));
};

// The W3C event angles for a phone whose own axes (x right, y top, z out of the screen)
// point along X, Y, Z, given in three.js's world axes.
const eventForDevice = (Xt, Yt, Zt) => {
  // W3C world axes are x east, y north, z up; three.js's are x east, y up, z south.
  const toW3C = (v) => [v.x, -v.z, v.y];
  const X = toW3C(Xt);
  const Y = toW3C(Yt);
  const Z = toW3C(Zt);
  // R = Rz(a) Rx(b) Ry(g); columns are the device axes. R[2][1] = sin b.
  const R = [[X[0], Y[0], Z[0]], [X[1], Y[1], Z[1]], [X[2], Y[2], Z[2]]];
  let b = Math.asin(Math.max(-1, Math.min(1, R[2][1])));
  if (R[2][2] < 0) b = (b > 0 ? Math.PI : -Math.PI) - b;
  const cb = Math.cos(b);
  // Gimbal lock (beta exactly +-90): only alpha +- gamma is defined, so gamma is 0 and alpha
  // carries the rest, R = Rz(a) Rx(+-90).
  if (Math.abs(cb) < 1e-9) return { alpha: ((Math.atan2(R[1][0], R[0][0]) / DEG) + 360) % 360, beta: b / DEG, gamma: 0 };
  const a = Math.atan2(-R[0][1] / cb, R[1][1] / cb);
  const g = Math.atan2(-R[2][0] / cb, R[2][2] / cb);
  return { alpha: ((a / DEG) + 360) % 360, beta: b / DEG, gamma: g / DEG };
};

const forward = (q) => qRotate(q, [0, 0, -1]);
const angleBetween = (u, v) => Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])) / DEG;
const headingGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

describe('deviceQuaternion', () => {
  it('is three.js’s DeviceOrientationControls recipe', () => {
    for (const [a, b, g] of [[0, 0, 0], [30, 90, 0], [200, 85, -12], [350, -40, 60], [90, 170, 5], [10, 89.9, 89]]) {
      for (const orient of [0, 90, 270]) {
        const ours = deviceQuaternion(a, b, g, orient);
        const theirs = reference(a, b, g, orient);
        expect(qAngleDeg(ours, theirs)).toBeLessThan(1e-4); // acos near 1 limits the precision
      }
    }
  });

  it('looks level and north for a phone held upright, facing north', () => {
    const f = forward(deviceQuaternion(0, 90, 0));
    expect(f[0]).toBeCloseTo(0, 9);
    expect(f[1]).toBeCloseTo(0, 9);
    expect(f[2]).toBeCloseTo(-1, 9); // north is -z
  });

  it('turns a landscape screen’s up into the camera’s up', () => {
    // Upright, facing north, turned a quarter anticlockwise (screen angle 90): its right
    // edge (x) points up, its top (y) west, its screen (z) south, toward you.
    const e = eventForDevice(new Vector3(0, 1, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1));
    const q = deviceQuaternion(e.alpha, e.beta, e.gamma, 90);
    expect(qRotate(q, [0, 1, 0])[1]).toBeCloseTo(1, 9);
    expect(forward(q)[2]).toBeCloseTo(-1, 9);
    expect(headingGap(headingFromQuaternion(q), 0)).toBeLessThan(1e-6);
    // Without the screen angle, the camera would think it was rolled 90 deg.
    expect(qRotate(deviceQuaternion(e.alpha, e.beta, e.gamma, 0), [0, 1, 0])[1]).toBeCloseTo(0, 9);
  });
});

describe('the phone held upright (beta near 90): where single event angles break', () => {
  it('small gamma changes at beta = 90 move the camera a little and smoothly, never jump', () => {
    for (const beta of [88, 89.5, 90, 90.5, 92]) {
      let prev = null;
      let prevHeading = null;
      for (let gamma = -3; gamma <= 3.0001; gamma += 0.1) {
        const q = deviceQuaternion(30, beta, gamma);
        const h = headingFromQuaternion(q);
        if (prev) {
          expect(angleBetween(forward(prev), forward(q))).toBeLessThan(0.11); // no more than the 0.1 deg step
          expect(headingGap(prevHeading, h)).toBeLessThan(0.11);
        }
        prev = q;
        prevHeading = h;
      }
    }
  });

  it('follows a real phone rolled slightly while upright, although the event angles jump', () => {
    // What a browser reports as the phone, upright and facing 30 deg, rolls from -3 to +3
    // deg: alpha and gamma leap by ~180 deg at the upright point.
    const events = [];
    for (let roll = -3; roll <= 3.0001; roll += 0.25) events.push(eventFor(30, 0, roll));
    const alphas = events.map((e) => e.alpha);
    expect(Math.max(...alphas) - Math.min(...alphas)).toBeGreaterThan(90); // the naive reading's jump
    let prev = null;
    for (const e of events) {
      const q = deviceQuaternion(e.alpha, e.beta, e.gamma);
      expect(headingGap(headingFromQuaternion(q), 30)).toBeLessThan(1e-6);
      expect(forward(q)[1]).toBeCloseTo(0, 6); // still level
      if (prev) expect(qAngleDeg(prev, q)).toBeLessThan(0.26); // the 0.25 deg roll step, nothing more
      prev = q;
    }
  });

  it('reads the real heading when pitched and rolled, where 360 - alpha is far off', () => {
    for (const [pitch, roll] of [[-5, 1], [-5, 5], [-20, 5], [10, -4]]) {
      const e = eventFor(30, pitch, roll);
      const q = deviceQuaternion(e.alpha, e.beta, e.gamma);
      const f = forward(q);
      expect((Math.asin(f[1]) / DEG)).toBeCloseTo(pitch, 6);
      expect(headingGap(headingFromQuaternion(q), 30)).toBeLessThan(0.6);
      expect(headingGap(360 - e.alpha, 30)).toBeGreaterThan(10);
    }
  });
});

describe('headingFromQuaternion', () => {
  it('is 360 - alpha for a phone lying flat, face up', () => {
    for (const alpha of [0, 45, 170, 300]) {
      expect(headingGap(headingFromQuaternion(deviceQuaternion(alpha, 0, 0)), 360 - alpha)).toBeLessThan(1e-9);
    }
  });

  it('is where the camera looks for a phone held up, whatever its roll', () => {
    for (const roll of [-30, 0, 45, 90]) {
      const e = eventFor(250, 0, roll);
      expect(headingGap(headingFromQuaternion(deviceQuaternion(e.alpha, e.beta, e.gamma)), 250)).toBeLessThan(1e-6);
    }
  });

  it('moves smoothly from flat to upright', () => {
    let prev = null;
    for (let pitch = -90; pitch <= 0; pitch += 1) {
      const e = eventFor(120, pitch, 3);
      const h = headingFromQuaternion(deviceQuaternion(e.alpha, e.beta, e.gamma));
      if (prev !== null) expect(headingGap(prev, h)).toBeLessThan(1); // 1 deg steps of pitch
      prev = h;
    }
  });
});

describe('smoothQuaternion', () => {
  it('moves part of the way, and takes the short way round', () => {
    const a = deviceQuaternion(0, 90, 0);
    const b = deviceQuaternion(10, 90, 0);
    const half = smoothQuaternion(a, b, 0.5);
    expect(qAngleDeg(a, half)).toBeCloseTo(5, 3);
    const flipped = b.map((v) => -v); // the same orientation
    expect(qAngleDeg(a, smoothQuaternion(a, flipped, 0.5))).toBeCloseTo(5, 3);
    expect(smoothQuaternion(null, b, 0.5)).toBe(b);
  });
});
