// The "too dark for labels" rule (redesign AR Scan batch, piece 9): average brightness of a
// tiny sample, with leeway both ways and a few samples in a row before it changes its mind.
import { describe, it, expect } from 'vitest';
import {
  DARK_AFTER, DARK_BELOW, LIGHT_ABOVE, LIGHT_AFTER, NOT_DARK, SAMPLE_EVERY_MS, SAMPLE_H, SAMPLE_W,
  meanLuma, nextDarkness,
} from '../src/utils/arDarkness.js';

const run = (lumas, state = NOT_DARK) => lumas.reduce((s, l) => nextDarkness(s, l), state);
const DARK = { dark: true, run: 0 };

describe('meanLuma', () => {
  it('averages the pixels by luma weights', () => {
    expect(meanLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(127.5, 5);
    expect(meanLuma(new Uint8ClampedArray([0, 255, 0, 255]))).toBeCloseTo(0.587 * 255, 5);
  });
  it('nothing to average: null (a failed sample)', () => {
    expect(meanLuma(null)).toBeNull();
    expect(meanLuma(new Uint8ClampedArray(0))).toBeNull();
  });
});

describe('nextDarkness', () => {
  it('is small and infrequent: a 16 x 12 sample once a second', () => {
    expect(SAMPLE_W * SAMPLE_H).toBe(192);
    expect(SAMPLE_EVERY_MS).toBe(1000);
  });

  it('turns dark only after DARK_AFTER dark samples in a row', () => {
    expect(DARK_AFTER).toBe(3);
    expect(run([5, 5]).dark).toBe(false);
    expect(run([5, 5, 5]).dark).toBe(true);
  });

  it('a light sample in between starts the count again', () => {
    expect(run([5, 5, 100, 5, 5]).dark).toBe(false);
  });

  it('turns light again only after LIGHT_AFTER light samples in a row', () => {
    expect(LIGHT_AFTER).toBe(2);
    expect(run([100], DARK).dark).toBe(true);
    expect(run([100, 100], DARK).dark).toBe(false);
    expect(run([100, 5, 100], DARK).dark).toBe(true);
  });

  it('has leeway both ways: a sample between the two thresholds changes nothing', () => {
    const between = (DARK_BELOW + LIGHT_ABOVE) / 2;
    expect(DARK_BELOW).toBeLessThan(LIGHT_ABOVE);
    expect(run([between, between, between, between]).dark).toBe(false);
    expect(run([between, between, between, between], DARK).dark).toBe(true);
    // Exactly on a threshold counts as the leeway too.
    expect(run([DARK_BELOW, DARK_BELOW, DARK_BELOW]).dark).toBe(false);
    expect(run([LIGHT_ABOVE, LIGHT_ABOVE], DARK).dark).toBe(true);
  });

  it('a failed sample means not dark, at once: if sampling fails, nothing hides', () => {
    expect(nextDarkness(DARK, null)).toEqual(NOT_DARK);
    expect(nextDarkness({ dark: false, run: 2 }, null)).toEqual(NOT_DARK);
    expect(nextDarkness(DARK, NaN)).toEqual(NOT_DARK);
  });
});
