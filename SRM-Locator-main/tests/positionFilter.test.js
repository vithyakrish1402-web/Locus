import { describe, expect, it } from 'vitest';
import {
  MAX_JUMP_M, MIN_CONFIDENCE, PROCESS_NOISE_M2_PER_S, REACQUIRE_AFTER_REJECTS, createPositionFilter,
} from '../src/utils/positionFilter.js';

const STALE = 70_000;
const STEP = 35_000;
const T0 = 1_000_000;
const est = (x, y, confidence = 1) => ({ x, y, confidence });
const P = (x, y) => ({ x, y });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Two rooms side by side with a wall between them and a doorway in it.
const walls = [{ a: P(10, 0), b: P(10, 4) }, { a: P(10, 6), b: P(10, 10) }];
const walkable = [[P(0, 0), P(20, 0), P(20, 10), P(0, 10)]];

describe('position filter', () => {
  it('takes the very first estimate as is', () => {
    const f = createPositionFilter({ staleMs: STALE });
    expect(f.position).toBeNull();
    f.update(est(500, -300), T0);
    expect(f.position).toEqual(P(500, -300));
    expect(f.status).toBe('tracking');
  });

  it('converges on a steady stream and is steadier than the raw estimates', () => {
    const f = createPositionFilter({ staleMs: STALE });
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 8; // +-4 m
    const truth = P(30, 40);
    const raw = [];
    const filtered = [];
    for (let i = 0; i < 40; i++) {
      const e = est(truth.x + noise(), truth.y + noise());
      f.update(e, T0 + i * STEP);
      if (i >= 10) {
        raw.push(dist(e, truth));
        filtered.push(dist(f.position, truth));
      }
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(filtered)).toBeLessThan(mean(raw));
    expect(mean(filtered)).toBeLessThan(2.5);
  });

  it('rejects a guess more than 25 m from the position on the very next scan', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    expect(f.update(est(30, 0), T0 + STEP)).toBe('rejected');
    expect(f.position).toEqual(P(0, 0));
  });

  it('accepts a move just under the cap', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    expect(f.update(est(MAX_JUMP_M - 1, 0), T0 + STEP)).toBe('tracking');
    expect(f.position.x).toBeGreaterThan(0);
  });

  it('the speed term limits a short gap: 2 m/s over 5 s is 10 m plus the noise', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    expect(f.update(est(20, 0), T0 + 5_000)).toBe('rejected'); // 10 + 4 = 14 allowed
    const g = createPositionFilter({ staleMs: STALE });
    g.update(est(0, 0), T0);
    expect(g.update(est(12, 0), T0 + 5_000)).toBe('tracking');
  });

  it('the speed allowance counts time since the last ACCEPTED estimate, not the last one seen', () => {
    // The person keeps walking while estimates are being rejected: 10 s at 2 m/s plus noise
    // allows 24 m, though only 5 s have passed since the bad estimate.
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    expect(f.update(est(40, 0), T0 + 5_000)).toBe('rejected');
    expect(f.update(est(18, 0), T0 + 10_000)).toBe('tracking');
  });

  it('two rejections in a row restart from the newest estimate, then it tracks again', () => {
    expect(REACQUIRE_AFTER_REJECTS).toBe(2);
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    expect(f.update(est(60, 0), T0 + STEP)).toBe('rejected');
    expect(f.update(est(61, 0), T0 + 2 * STEP)).toBe('reacquiring');
    expect(f.position).toEqual(P(61, 0));
    expect(f.update(est(62, 0), T0 + 3 * STEP)).toBe('tracking');
  });

  it('an accepted estimate between two bad ones resets the count', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    f.update(est(60, 0), T0 + STEP);
    f.update(est(1, 0), T0 + 2 * STEP);
    expect(f.update(est(60, 0), T0 + 3 * STEP)).toBe('rejected');
  });

  it('after a gap longer than the staleness constant, takes the next estimate as is', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    expect(f.update(est(200, 0), T0 + STALE + 1)).toBe('tracking');
    expect(f.position).toEqual(P(200, 0));
  });

  it('coasting grows the uncertainty by the process noise', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    f.update(est(1, 0), T0 + STEP);
    const settled = f.uncertaintyM;
    f.update(est(90, 0), T0 + 2 * STEP);
    expect(f.uncertaintyM).toBeGreaterThan(settled);
    expect(f.uncertaintyM ** 2).toBeCloseTo(settled ** 2 + PROCESS_NOISE_M2_PER_S * 35, 6);
  });

  it('accepting an estimate shrinks the uncertainty', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(0, 0), T0);
    const first = f.uncertaintyM;
    f.update(est(0.5, 0), T0 + STEP);
    f.update(est(0.2, 0), T0 + 2 * STEP);
    expect(f.uncertaintyM).toBeLessThan(first);
  });

  it('trusts a low-confidence estimate less', () => {
    const run = (confidence) => {
      const f = createPositionFilter({ staleMs: STALE });
      f.update(est(0, 0), T0);
      f.update(est(10, 0, confidence), T0 + STEP);
      return f.position.x;
    };
    expect(run(1)).toBeGreaterThan(run(0.3));
    expect(run(0)).toBe(run(MIN_CONFIDENCE)); // floored, not divided by zero
  });

  it('ignores an estimate with no coordinates', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(5, 5), T0);
    f.update({ x: null, y: null, confidence: 0 }, T0 + STEP);
    expect(f.position).toEqual(P(5, 5));
  });

  it('reset() forgets the position', () => {
    const f = createPositionFilter({ staleMs: STALE });
    f.update(est(5, 5), T0);
    f.reset();
    expect(f.position).toBeNull();
    f.update(est(90, 90), T0 + STEP);
    expect(f.position).toEqual(P(90, 90));
  });
});

describe('position filter with walls', () => {
  const make = () => createPositionFilter({ staleMs: STALE, walls, walkable });

  it('rejects an estimate that would need walking through a wall', () => {
    const f = make();
    f.update(est(8, 2), T0);
    expect(f.update(est(12, 2), T0 + STEP)).toBe('rejected');
    expect(f.position).toEqual(P(8, 2));
  });

  it('lets the track go through the doorway', () => {
    const f = make();
    f.update(est(8, 5), T0);
    expect(f.update(est(12, 5), T0 + STEP)).toBe('tracking');
    expect(f.position.x).toBeGreaterThan(8);
  });

  it('allows an estimate next to the wall on the same side', () => {
    const f = make();
    f.update(est(8, 2), T0);
    expect(f.update(est(9.5, 2), T0 + STEP)).toBe('tracking');
  });

  it('snaps a position outside the walkable space back inside', () => {
    const f = make();
    f.update(est(18, 5), T0);
    f.update(est(26, 5), T0 + STEP);
    expect(f.position.x).toBeLessThanOrEqual(20);
    expect(f.status).toBe('tracking');
  });

  it('snaps the very first estimate too', () => {
    const f = make();
    f.update(est(-50, 5), T0);
    expect(f.position).toEqual(P(0, 5));
  });

  it('never reports a position outside walkable space', () => {
    const f = make();
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      f.update(est(rnd() * 40 - 10, rnd() * 20 - 5, rnd()), T0 + i * STEP);
      const p = f.position;
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(20 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('two wall rejections in a row also restart the filter', () => {
    const f = make();
    f.update(est(8, 2), T0);
    f.update(est(12, 2), T0 + STEP);
    expect(f.update(est(12.5, 2), T0 + 2 * STEP)).toBe('reacquiring');
    expect(f.position).toEqual(P(12.5, 2));
  });
});
