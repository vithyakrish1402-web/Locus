import { describe, it, expect } from 'vitest';
import {
  createHeadingFilter,
  createCalibrationMonitor,
  HEADING_DEAD_ZONE_DEG,
  HEADING_FAST_CONFIRM_READINGS,
  CALIBRATION_SHOW_AFTER_MS,
  CALIBRATION_HIDE_AFTER_MS,
} from '../src/utils/arHeading.js';
import { angularDifference } from '../src/utils/geoMath.js';

const STEP_MS = 16; // ~60 Hz

// Feeds `readings` (degrees) one per STEP_MS from `t0`; returns the last output and the time.
const feed = (filter, readings, t0 = 0) => {
  let out = null;
  let t = t0;
  for (const r of readings) {
    t += STEP_MS;
    out = filter.update(r, t);
  }
  return { out, t };
};
const repeat = (value, n) => Array.from({ length: n }, () => value);

describe('createHeadingFilter', () => {
  it('takes the first reading as-is', () => {
    expect(createHeadingFilter().update(123, 0)).toEqual({ heading: 123, smoothed: 123, fast: false });
  });

  it('never goes the long way round through north', () => {
    const f = createHeadingFilter();
    f.update(355, 0);
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += STEP_MS;
      const { smoothed } = f.update(5, t);
      // Every step stays on the short arc between 355 and 5.
      expect(Math.abs(angularDifference(smoothed, 0))).toBeLessThanOrEqual(5.0001);
    }
    expect(f.update(5, t + STEP_MS).smoothed).toBeCloseTo(5, 0);
  });

  it('holds the shown heading still through jitter under the dead-zone', () => {
    const f = createHeadingFilter();
    f.update(90, 0);
    const jitter = Array.from({ length: 120 }, (_, i) => 90 + (i % 2 ? 1 : -1) * (HEADING_DEAD_ZONE_DEG * 0.9));
    let t = 0;
    for (const r of jitter) {
      t += STEP_MS;
      expect(f.update(r, t).heading).toBe(90);
    }
  });

  it('follows a real turn, and switches to fast mode for it', () => {
    const f = createHeadingFilter();
    f.update(0, 0);
    // A 90 deg/s turn: 1.44 deg per reading, for a second.
    const turn = Array.from({ length: 62 }, (_, i) => (i + 1) * 1.44);
    const { out } = feed(f, turn);
    expect(out.fast).toBe(true);
    expect(Math.abs(angularDifference(out.heading, 89.3))).toBeLessThan(12);
  });

  it('lags a turn more without fast mode', () => {
    const turn = Array.from({ length: 62 }, (_, i) => (i + 1) * 1.44);
    const withFast = feed(createHeadingFilter(), [0, ...turn]).out.heading;
    const slowOnly = feed(createHeadingFilter({ fastConfirm: Infinity }), [0, ...turn]).out.heading;
    expect(angularDifference(89.3, slowOnly)).toBeGreaterThan(angularDifference(89.3, withFast) + 5);
  });

  it('stays fast all through a steady turn, and leaves fast mode once it stops', () => {
    const f = createHeadingFilter();
    f.update(0, 0);
    const outs = Array.from({ length: 62 }, (_, i) => f.update((i + 1) * 1.44, (i + 1) * STEP_MS));
    const firstFast = outs.findIndex((o) => o.fast);
    expect(firstFast).toBeGreaterThan(0);
    expect(outs.slice(firstFast).every((o) => o.fast)).toBe(true);
    const settle = feed(f, repeat(89.3, 30), 62 * STEP_MS).out;
    expect(settle.fast).toBe(false);
  });

  it('does not go fast for a one-off spike, and barely moves for it', () => {
    const f = createHeadingFilter();
    feed(f, repeat(40, 30));
    const spike = f.update(100, 30 * STEP_MS + STEP_MS);
    expect(spike.fast).toBe(false);
    expect(Math.abs(angularDifference(spike.smoothed, 40))).toBeLessThan(5);
    const after = feed(f, repeat(40, 5), 31 * STEP_MS).out;
    expect(after.fast).toBe(false);
  });

  it(`needs ${HEADING_FAST_CONFIRM_READINGS} readings on the same side before going fast`, () => {
    const f = createHeadingFilter();
    f.update(0, 0);
    const outs = [30, 30, 30].map((r, i) => f.update(r, (i + 1) * STEP_MS));
    expect(outs.map((o) => o.fast)).toEqual([false, false, true]);
    // Alternating sides never confirms.
    const g = createHeadingFilter();
    g.update(0, 0);
    expect([30, -30, 30, -30].map((r, i) => g.update(r, (i + 1) * STEP_MS).fast)).toEqual([false, false, false, false]);
  });

  it('is time-based: the same span of time settles the same way at any rate', () => {
    const at60 = createHeadingFilter({ fastConfirm: Infinity, deadZoneDeg: 0 });
    const at20 = createHeadingFilter({ fastConfirm: Infinity, deadZoneDeg: 0 });
    at60.update(0, 0);
    at20.update(0, 0);
    let a;
    let b;
    for (let t = 1; t <= 30; t++) a = at60.update(10, t * 16);
    for (let t = 1; t <= 10; t++) b = at20.update(10, t * 48);
    expect(a.smoothed).toBeCloseTo(b.smoothed, 1);
  });
});

describe('createCalibrationMonitor', () => {
  // Runs `count` readings from `gen(i)` one per STEP_MS from `t0`; returns each result.
  const run = (m, count, gen, t0 = 0, accuracy = null) =>
    Array.from({ length: count }, (_, i) => ({ t: t0 + (i + 1) * STEP_MS, ...m.update(gen(i), t0 + (i + 1) * STEP_MS, accuracy) }));
  const steadyTurn = (i) => (i * 1.5) % 360;
  const noisy = (i) => 90 + (i % 2 ? 15 : -15);

  it('starts hidden and stays hidden for a steady compass, even while turning', () => {
    const m = createCalibrationMonitor();
    expect(run(m, 400, steadyTurn).every((r) => !r.show)).toBe(true);
  });

  it(`shows only after noise has lasted ${CALIBRATION_SHOW_AFTER_MS} ms`, () => {
    const m = createCalibrationMonitor();
    const rs = run(m, 250, noisy);
    const first = rs.find((r) => r.show);
    expect(first).toBeTruthy();
    expect(first.t).toBeGreaterThanOrEqual(CALIBRATION_SHOW_AFTER_MS);
    expect(first.t).toBeLessThan(CALIBRATION_SHOW_AFTER_MS + 300);
  });

  it('ignores a short burst of noise', () => {
    const m = createCalibrationMonitor();
    run(m, 60, steadyTurn);
    const burst = run(m, 60, noisy, 60 * STEP_MS); // ~1 s of noise
    const after = run(m, 200, steadyTurn, 120 * STEP_MS);
    expect([...burst, ...after].every((r) => !r.show)).toBe(true);
  });

  it(`hides once the compass has been good for ${CALIBRATION_HIDE_AFTER_MS} ms, and not before`, () => {
    const m = createCalibrationMonitor();
    const bad = run(m, 250, noisy);
    expect(bad.at(-1).show).toBe(true);
    const good = run(m, 300, (i) => 90 + (i % 2 ? 0.3 : -0.3), bad.at(-1).t);
    const firstHidden = good.find((r) => !r.show);
    expect(firstHidden).toBeTruthy();
    // The window has to empty of noise (1 s) before the 2 s hold even starts.
    expect(firstHidden.t - bad.at(-1).t).toBeGreaterThanOrEqual(CALIBRATION_HIDE_AFTER_MS);
    // Once hidden it stays hidden.
    expect(good.slice(good.indexOf(firstHidden)).every((r) => !r.show)).toBe(true);
  });

  it('has a band between the show and hide levels where it holds its state (no flicker)', () => {
    // Alternating +-a has a second difference of 4a: 4.4 deg, below the show level and
    // above the hide level.
    const middling = (i) => 90 + (i % 2 ? 1.1 : -1.1);
    const hidden = createCalibrationMonitor();
    expect(run(hidden, 400, middling).every((r) => !r.show)).toBe(true);
    const shown = createCalibrationMonitor();
    const t = run(shown, 250, noisy).at(-1).t;
    expect(run(shown, 400, middling, t).every((r) => r.show)).toBe(true);
  });

  it('uses the platform accuracy where there is one (iOS), with its own hysteresis', () => {
    const m = createCalibrationMonitor();
    const steady = (i) => 10 + (i % 2 ? 0.2 : -0.2);
    expect(run(m, 250, steady, 0, 40).at(-1).show).toBe(true); // 40 deg: bad
    expect(run(m, 250, steady, 4000, 20).at(-1).show).toBe(true); // between: holds
    expect(run(m, 250, steady, 8000, 10).at(-1).show).toBe(false); // 10 deg: good
    const invalid = createCalibrationMonitor();
    expect(run(invalid, 250, steady, 0, -1).at(-1).show).toBe(true); // negative: invalid
  });
});
