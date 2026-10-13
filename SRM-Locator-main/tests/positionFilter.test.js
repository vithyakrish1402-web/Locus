import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GPS_TRUST_MAX_ACCURACY_M, MAX_JUMP_M, MAX_WALK_SPEED_MPS, MIN_CONFIDENCE, PROCESS_NOISE_M2_PER_S,
  REACQUIRE_AFTER_REJECTS, createPositionFilter,
} from '../src/utils/positionFilter.js';
import { floor7Plan as plan } from '../src/utils/floor7Plan.js';

const STALE = 70_000;
const STEP = 35_000;
const T0 = 1_000_000;
const est = (x, y, confidence = 1) => ({ x, y, confidence });
const P = (x, y) => ({ x, y });
const near = (p, x, y, digits = 6) => {
  expect(p.x).toBeCloseTo(x, digits);
  expect(p.y).toBeCloseTo(y, digits);
};
const make = () => createPositionFilter({ staleMs: STALE, plan });
const onCorridor = (p) => plan.snapToCorridor(p.x, p.y).distanceMoved < 1e-9;

// Most of these walk along the lab passage (y = 0, x from -9 to 37), where walking and
// straight-line distance agree. The back-path tests further down are where they do not.
describe('position filter', () => {
  it('takes the very first estimate as is (once it is on a corridor)', () => {
    const f = make();
    expect(f.position).toBeNull();
    f.update(est(5, 0), T0);
    near(f.position, 5, 0);
    expect(f.status).toBe('tracking');
  });

  it('puts the very first estimate onto the nearest corridor, even from inside a room or off the floor', () => {
    const inRoom = make();
    inRoom.update(est(-14.2, 11.75), T0); // the middle of Room 701
    near(inRoom.position, -9, 11.75);
    const off = make();
    off.update(est(500, -300), T0);
    expect(onCorridor(off.position)).toBe(true);
  });

  it('converges on a steady stream and is steadier than the raw estimates', () => {
    const f = make();
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 8; // +-4 m
    const truth = P(17, 0);
    const raw = [];
    const filtered = [];
    for (let i = 0; i < 40; i++) {
      const e = est(truth.x + noise(), truth.y + noise());
      f.update(e, T0 + i * STEP);
      if (i >= 10) {
        raw.push(plan.walkingDistance(e, truth));
        filtered.push(plan.walkingDistance(f.position, truth));
      }
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(filtered)).toBeLessThan(mean(raw));
    expect(mean(filtered)).toBeLessThan(2.5);
  });

  it('rejects an estimate more than 25 m away on foot on the very next scan', () => {
    expect(MAX_JUMP_M).toBe(25);
    const f = make();
    f.update(est(-9, 0), T0);
    expect(f.update(est(17, 0), T0 + STEP)).toBe('rejected'); // 26 m
    near(f.position, -9, 0);
  });

  it('accepts a move just under the cap', () => {
    const f = make();
    f.update(est(-9, 0), T0);
    expect(f.update(est(-9 + MAX_JUMP_M - 1, 0), T0 + STEP)).toBe('tracking');
    expect(f.position.x).toBeGreaterThan(-9);
  });

  it('the speed term limits a short gap: 2 m/s over 5 s is 10 m plus the uncertainty', () => {
    expect(MAX_WALK_SPEED_MPS).toBe(2);
    const f = make();
    f.update(est(0, 0), T0);
    expect(f.update(est(20, 0), T0 + 5_000)).toBe('rejected'); // 10 + ~4.4 allowed
    const g = make();
    g.update(est(0, 0), T0);
    expect(g.update(est(12, 0), T0 + 5_000)).toBe('tracking');
  });

  it('the speed allowance counts time since the last ACCEPTED estimate, not the last one seen', () => {
    // The person keeps walking while estimates are being rejected: 10 s at 2 m/s plus the
    // uncertainty allows ~24 m, though only 5 s have passed since the bad estimate.
    const f = make();
    f.update(est(-9, 0), T0);
    expect(f.update(est(37, 0), T0 + 5_000)).toBe('rejected');
    expect(f.update(est(9, 0), T0 + 10_000)).toBe('tracking');
  });

  it('two rejections in a row restart from the newest estimate, then it tracks again', () => {
    expect(REACQUIRE_AFTER_REJECTS).toBe(2);
    const f = make();
    f.update(est(-9, 0), T0);
    expect(f.update(est(30, 0), T0 + STEP)).toBe('rejected');
    expect(f.update(est(31, 0), T0 + 2 * STEP)).toBe('reacquiring');
    near(f.position, 31, 0);
    expect(f.update(est(32, 0), T0 + 3 * STEP)).toBe('tracking');
  });

  it('an accepted estimate between two bad ones resets the count', () => {
    const f = make();
    f.update(est(-9, 0), T0);
    f.update(est(30, 0), T0 + STEP);
    f.update(est(-8, 0), T0 + 2 * STEP);
    expect(f.update(est(30, 0), T0 + 3 * STEP)).toBe('rejected');
  });

  it('after a gap longer than the staleness constant, takes the next estimate as is', () => {
    const f = make();
    f.update(est(-9, 0), T0);
    expect(f.update(est(35, 0), T0 + STALE + 1)).toBe('tracking');
    near(f.position, 35, 0);
  });

  it('coasting grows the uncertainty by the process noise', () => {
    const f = make();
    f.update(est(0, 0), T0);
    f.update(est(1, 0), T0 + STEP);
    const settled = f.uncertaintyM;
    f.update(est(37, 0), T0 + 2 * STEP); // rejected
    expect(f.uncertaintyM).toBeGreaterThan(settled);
    expect(f.uncertaintyM ** 2).toBeCloseTo(settled ** 2 + PROCESS_NOISE_M2_PER_S * 35, 6);
  });

  it('accepting an estimate shrinks the uncertainty', () => {
    const f = make();
    f.update(est(0, 0), T0);
    const first = f.uncertaintyM;
    f.update(est(0.5, 0), T0 + STEP);
    f.update(est(0.2, 0), T0 + 2 * STEP);
    expect(f.uncertaintyM).toBeLessThan(first);
  });

  it('trusts a low-confidence estimate less', () => {
    const run = (confidence) => {
      const f = make();
      f.update(est(0, 0), T0);
      f.update(est(10, 0, confidence), T0 + STEP);
      return f.position.x;
    };
    expect(run(1)).toBeGreaterThan(run(0.3));
    expect(run(0)).toBe(run(MIN_CONFIDENCE)); // floored, not divided by zero
  });

  it('ignores an estimate with no coordinates', () => {
    const f = make();
    f.update(est(5, 0), T0);
    f.update({ x: null, y: null, confidence: 0 }, T0 + STEP);
    near(f.position, 5, 0);
  });

  it('reset() forgets the position', () => {
    const f = make();
    f.update(est(5, 0), T0);
    f.reset();
    expect(f.position).toBeNull();
    f.update(est(30, 0), T0 + STEP);
    near(f.position, 30, 0);
  });

  it('shows the newest estimate snapped onto the corridor, accepted or not', () => {
    const f = make();
    expect(f.lastSnapped).toBeNull();
    f.update(est(-14.2, 11.75), T0);
    near(f.lastSnapped, -9, 11.75);
    f.update(est(30, 3), T0 + STEP); // rejected, but still what the gate judged
    near(f.lastSnapped, 30, 0);
  });
});

describe('the output is always on a corridor: the wall rule is built in', () => {
  it('never reports a position inside a room, inside a wall or off the floor, whatever it is fed', () => {
    const f = make();
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 400; i++) {
      f.update(est(rnd() * 100 - 30, rnd() * 60 - 20, rnd()), T0 + i * STEP);
      expect(onCorridor(f.position), `step ${i}`).toBe(true);
    }
  });

  it('keeps every accepted correction on a corridor even when it crosses to another one', () => {
    const f = make();
    f.update(est(6, 7.9), T0); // the new ladies restroom, on west_back
    expect(f.update(est(-9, 0), T0 + STEP)).toBe('tracking'); // 22.9 m on foot: round the corner
    expect(onCorridor(f.position)).toBe(true);
    // the track went along the back path and down the spine, not straight through the lobby
    expect(f.position.y === 7.9 || f.position.x === -9 || Math.abs(f.position.x + 9) < 1e-9).toBe(true);
  });
});

describe('the gate judges WALKING distance, not straight-line distance', () => {
  const W = (x, y) => ({ x, y });
  const restroom = W(6, 7.9); // the new ladies restroom (W), at the end of the west back path
  const labD = W(11, 0); // Lab D/E's door, in the passage

  it('is the case: 9 m on the map, about 43 m on foot', () => {
    const straight = Math.hypot(restroom.x - labD.x, restroom.y - labD.y);
    expect(straight).toBeLessThan(10);
    expect(straight).toBeLessThan(MAX_JUMP_M); // a straight-line gate would let this through
    expect(plan.walkingDistance(restroom, labD)).toBeCloseTo(15 + 7.9 + 20, 6); // out the back path, down the spine, along the passage
    expect(plan.walkingDistance(restroom, labD)).toBeGreaterThan(MAX_JUMP_M);
  });

  it('enters the restroom back path along the corridor, then rejects a later estimate that jumps to the labs', () => {
    const f = make();
    // Up the west spine and in along the back path, a believable walk at one scan every 35 s.
    expect(f.update(est(-9, 0), T0)).toBe('tracking'); // the junction by lift lobby A
    expect(f.update(est(-9, 7.9), T0 + STEP)).toBe('tracking'); // up the spine to the back-path junction
    expect(f.update(est(-1, 7.9), T0 + 2 * STEP)).toBe('tracking'); // in along the back path
    expect(f.update(est(6, 7.9), T0 + 3 * STEP)).toBe('tracking'); // the restroom door
    const before = f.position;
    expect(before.y).toBeCloseTo(7.9, 6); // on the back path, not in the passage
    expect(before.x).toBeGreaterThan(0);

    // Lab D's signal leaks into the restroom: the next estimate says "Lab D".
    expect(f.update(est(labD.x, labD.y), T0 + 4 * STEP)).toBe('rejected');
    near(f.position, before.x, before.y); // the track stayed in the restroom

    // And it is the walking distance that rejected it: the straight-line move is small.
    expect(Math.hypot(labD.x - before.x, labD.y - before.y)).toBeLessThan(MAX_JUMP_M);
  });

  it('a second estimate in the labs means the filter was lost, not the person: it restarts there', () => {
    const f = make();
    f.update(est(6, 7.9), T0);
    expect(f.update(est(11, 0), T0 + STEP)).toBe('rejected');
    expect(f.update(est(11.5, 0), T0 + 2 * STEP)).toBe('reacquiring');
    near(f.position, 11.5, 0);
  });

  it('lets the walk out of the back path through, because it follows the corridors', () => {
    const f = make();
    f.update(est(6, 7.9), T0);
    expect(f.update(est(-9, 7.9), T0 + STEP)).toBe('tracking'); // 15 m along the back path
    expect(f.update(est(-9, 0), T0 + 2 * STEP)).toBe('tracking'); // 7.9 m down the spine
    expect(f.update(est(11, 0), T0 + 3 * STEP)).toBe('tracking'); // 20 m along the passage
  });
});

describe('GPS stays out', () => {
  it('has the 50 m trust constant written down and unused: nothing in src reads it', () => {
    expect(GPS_TRUST_MAX_ACCURACY_M).toBe(50);
    const dir = join(process.cwd(), 'src');
    const readers = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(jsx?|mjs)$/.test(e.name) && readFileSync(p, 'utf8').includes('GPS_TRUST_MAX_ACCURACY_M')) readers.push(e.name);
      }
    };
    walk(dir);
    expect(readers).toEqual(['positionFilter.js']);
    expect(readFileSync(join(dir, 'utils', 'positionFilter.js'), 'utf8')).toContain('UNUSED');
  });
});
