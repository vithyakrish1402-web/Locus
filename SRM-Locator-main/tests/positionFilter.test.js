import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_WITHIN_M, GPS_TRUST_MAX_ACCURACY_M, MAX_JUMP_M, MAX_WALK_SPEED_MPS, MIN_CONFIDENCE, PROCESS_NOISE_M2_PER_S,
  REACQUIRE_AFTER_REJECTS, createPositionFilter,
} from '../src/utils/positionFilter.js';
import { floor7Plan as plan } from '../src/utils/floor7Plan.js';

const STALE = 70_000;
const STEP = 35_000;
const T0 = 1_000_000;
const est = (x, y, confidence = 1) => ({ x, y, confidence });
const near = (p, x, y, digits = 6) => {
  expect(p.x).toBeCloseTo(x, digits);
  expect(p.y).toBeCloseTo(y, digits);
};
const make = (rules) => createPositionFilter({ staleMs: STALE, plan, rules });
const onCorridor = (p) => plan.snapToCorridor(p.x, p.y).distanceMoved < 1e-9;

/** Starts a track at (x, y) as of T0: two agreeing estimates a second apart, the second at T0. */
const begin = (f, ...args) => {
  f.update(est(...args), T0 - 1_000);
  f.update(est(...args), T0);
};

// Most of these walk along the lab passage (y = 0, x from -9 to 37), where walking and
// straight-line distance agree. The back-path tests further down are where they do not.
describe('position filter', () => {
  it('starts a track at the second of two agreeing estimates, and takes that one as is (once on a corridor)', () => {
    const f = make();
    begin(f, 5, 0);
    near(f.position, 5, 0);
    expect(f.status).toBe('tracking');
  });

  it('puts the start onto the nearest corridor, even from inside a room or off the floor', () => {
    const inRoom = make();
    begin(inRoom, -14.2, 11.75); // the middle of Room 701
    near(inRoom.position, -9, 11.75);
    const off = make();
    begin(off, 500, -300);
    expect(onCorridor(off.position)).toBe(true);
  });

  it('converges on a steady stream and is steadier than the raw estimates', () => {
    const f = make();
    let seed = 7;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 8; // +-4 m
    const truth = { x: 17, y: 0 };
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
    begin(f, -9, 0);
    expect(f.update(est(17, 0), T0 + STEP)).toBe('rejected'); // 26 m
    near(f.position, -9, 0);
  });

  it('accepts a move just under the cap', () => {
    const f = make();
    begin(f, -9, 0);
    expect(f.update(est(-9 + MAX_JUMP_M - 1, 0), T0 + STEP)).toBe('tracking');
    expect(f.position.x).toBeGreaterThan(-9);
  });

  it('the speed term limits a short gap: 2 m/s over 5 s is 10 m plus the uncertainty', () => {
    expect(MAX_WALK_SPEED_MPS).toBe(2);
    const f = make();
    begin(f, 0, 0);
    expect(f.update(est(20, 0), T0 + 5_000)).toBe('rejected'); // 10 + ~4.4 allowed
    const g = make();
    begin(g, 0, 0);
    expect(g.update(est(12, 0), T0 + 5_000)).toBe('tracking');
  });

  it('the speed allowance counts time since the last ACCEPTED estimate, not the last one seen', () => {
    // The person keeps walking while estimates are being rejected: 10 s at 2 m/s plus the
    // uncertainty allows ~24 m, though only 5 s have passed since the bad estimate.
    const f = make();
    begin(f, -9, 0);
    expect(f.update(est(37, 0), T0 + 5_000)).toBe('rejected');
    expect(f.update(est(9, 0), T0 + 10_000)).toBe('tracking');
  });

  it('an accepted estimate between two bad ones resets the count', () => {
    const f = make();
    begin(f, -9, 0);
    f.update(est(30, 0), T0 + STEP);
    f.update(est(-8, 0), T0 + 2 * STEP);
    expect(f.update(est(30, 0), T0 + 3 * STEP)).toBe('rejected');
  });

  it('coasting grows the uncertainty by the process noise', () => {
    const f = make();
    begin(f, 0, 0);
    f.update(est(1, 0), T0 + STEP);
    const settled = f.uncertaintyM;
    f.update(est(37, 0), T0 + 2 * STEP); // rejected
    expect(f.uncertaintyM).toBeGreaterThan(settled);
    expect(f.uncertaintyM ** 2).toBeCloseTo(settled ** 2 + PROCESS_NOISE_M2_PER_S * 35, 6);
  });

  it('accepting an estimate shrinks the uncertainty', () => {
    const f = make();
    begin(f, 0, 0);
    const first = f.uncertaintyM;
    f.update(est(0.5, 0), T0 + STEP);
    f.update(est(0.2, 0), T0 + 2 * STEP);
    expect(f.uncertaintyM).toBeLessThan(first);
  });

  it('trusts a low-confidence estimate less', () => {
    const run = (confidence) => {
      const f = make();
      begin(f, 0, 0);
      f.update(est(10, 0, confidence), T0 + STEP);
      return f.position.x;
    };
    expect(run(1)).toBeGreaterThan(run(0.3));
    expect(run(0)).toBe(run(MIN_CONFIDENCE)); // floored, not divided by zero
  });

  it('ignores an estimate with no coordinates', () => {
    const f = make();
    begin(f, 5, 0);
    f.update({ x: null, y: null, confidence: 0 }, T0 + STEP);
    near(f.position, 5, 0);
  });

  it('reset() forgets the position and any estimate waiting to be confirmed', () => {
    const f = make();
    begin(f, 5, 0);
    f.reset();
    expect(f.position).toBeNull();
    expect(f.update(est(30, 0), T0 + STEP)).toBe('confirming');
    f.reset();
    expect(f.update(est(30, 0), T0 + 2 * STEP)).toBe('confirming'); // the one waiting before the reset is gone
    expect(f.position).toBeNull();
  });

  it('shows the newest estimate snapped onto the corridor, accepted or not, even before a start is confirmed', () => {
    const f = make();
    expect(f.lastSnapped).toBeNull();
    f.update(est(-14.2, 11.75), T0);
    near(f.lastSnapped, -9, 11.75);
    f.update(est(-14.2, 11.75), T0 + 1_000); // second one agrees: tracking
    f.update(est(-9, 30), T0 + STEP); // rejected
    near(f.lastSnapped, -9, 15); // snapped to the north end of the spine, still what the gate judged
  });
});

describe('start-up confirmation', () => {
  it('shows nothing for the first estimate: no position, status "confirming"', () => {
    const f = make();
    expect(CONFIRM_WITHIN_M).toBe(12);
    expect(f.update(est(5, 0), T0)).toBe('confirming');
    expect(f.position).toBeNull();
    expect(f.uncertaintyM).toBe(0);
  });

  it('starts the track when the second estimate is within 12 m on foot of the first', () => {
    const f = make();
    f.update(est(5, 0), T0);
    expect(f.update(est(5 + CONFIRM_WITHIN_M, 0), T0 + STEP)).toBe('tracking'); // exactly 12 m: agrees
    near(f.position, 17, 0); // the track begins at the newer estimate
  });

  it('does not start when the second is farther than 12 m; that one then waits for a third', () => {
    const f = make();
    f.update(est(5, 0), T0);
    expect(f.update(est(5 + CONFIRM_WITHIN_M + 0.5, 0), T0 + STEP)).toBe('confirming');
    expect(f.position).toBeNull();
    expect(f.update(est(18, 0), T0 + 2 * STEP)).toBe('tracking'); // agrees with the second, not the first
    near(f.position, 18, 0);
  });

  it('judges agreement on foot: a restroom and the labs are 9 m apart on the map and 43 m on foot', () => {
    const f = make();
    f.update(est(6, 7.9), T0); // the new ladies restroom, end of the west back path
    expect(Math.hypot(6 - 11, 7.9)).toBeLessThan(CONFIRM_WITHIN_M);
    expect(f.update(est(11, 0), T0 + STEP)).toBe('confirming'); // Lab D: straight-line close, on foot far
    expect(f.position).toBeNull();
  });

  it('forgets a waiting estimate after the staleness constant: two agreeing estimates too far apart in time do not confirm', () => {
    const f = make();
    f.update(est(5, 0), T0);
    expect(f.update(est(6, 0), T0 + STALE + 1)).toBe('confirming');
    expect(f.update(est(6.5, 0), T0 + STALE + 1 + STEP)).toBe('tracking');
  });

  it('after a gap longer than the staleness constant it forgets the track and confirms afresh', () => {
    const f = make();
    begin(f, -9, 0);
    expect(f.update(est(35, 0), T0 + STALE + 1)).toBe('confirming'); // the old position is gone
    expect(f.position).toBeNull();
    expect(f.update(est(36, 0), T0 + STALE + 1 + STEP)).toBe('tracking');
    near(f.position, 36, 0);
  });

  it('a gap of exactly the staleness constant is still a track', () => {
    const f = make();
    begin(f, -9, 0);
    expect(f.update(est(-8, 0), T0 + STALE)).toBe('tracking');
  });

  it('confirms only once: after the start it takes estimates one at a time', () => {
    const f = make();
    begin(f, -9, 0);
    expect(f.update(est(-5, 0), T0 + STEP)).toBe('tracking');
    expect(f.position).not.toBeNull();
  });

  it('with the rule off a first estimate is taken as is, as before', () => {
    const f = make({ confirmStart: false });
    expect(f.update(est(5, 0), T0)).toBe('tracking');
    near(f.position, 5, 0);
    expect(f.update(est(200, 0), T0 + STALE + 1)).toBe('tracking'); // and so is the first after a gap
    near(f.position, 37, 0);
  });
});

describe('reacquire on agreement', () => {
  it('restarts at two rejected estimates that agree within 12 m, then tracks again', () => {
    expect(REACQUIRE_AFTER_REJECTS).toBe(2);
    const f = make();
    begin(f, -9, 0);
    expect(f.update(est(30, 0), T0 + STEP)).toBe('rejected');
    expect(f.update(est(31, 0), T0 + 2 * STEP)).toBe('reacquiring');
    near(f.position, 31, 0);
    expect(f.update(est(32, 0), T0 + 3 * STEP)).toBe('tracking');
  });

  it('does NOT restart when the two rejected estimates disagree: it stays where it was', () => {
    const f = make();
    begin(f, -9, 0);
    f.update(est(30, 0), T0 + STEP);
    expect(f.update(est(30 - CONFIRM_WITHIN_M - 1, 0), T0 + 2 * STEP)).toBe('rejected'); // 13 m from the first: still beyond 25 m of the track
    near(f.position, -9, 0);
  });

  it('restarts at the next rejected estimate that agrees with the one before it (estimates 10 s apart, inside the staleness window)', () => {
    const f = make();
    begin(f, -9, 0);
    f.update(est(30, 0), T0 + 10_000);
    expect(f.update(est(17, 0), T0 + 20_000)).toBe('rejected'); // 13 m from the first: they disagree, so no restart yet
    expect(f.update(est(18, 0), T0 + 30_000)).toBe('reacquiring'); // agrees with the one before it
    near(f.position, 18, 0);
  });

  it('after the staleness constant the track is gone anyway: a third rejection 35 s on starts a fresh confirmation', () => {
    const f = make();
    begin(f, -9, 0);
    f.update(est(30, 0), T0 + STEP);
    f.update(est(17, 0), T0 + 2 * STEP); // 70 s since the last accepted: still a track
    expect(f.update(est(18, 0), T0 + 3 * STEP)).toBe('confirming'); // 105 s: forgotten
    expect(f.position).toBeNull();
  });

  it('compares the two rejected estimates on foot: the restroom and the labs are 9 m apart on the map, 43 m on foot', () => {
    const f = make();
    begin(f, 37, 0); // the east end of the passage: both of these are beyond reach
    expect(f.update(est(6, 7.9), T0 + 10_000)).toBe('rejected'); // the new ladies restroom
    expect(f.update(est(11, 0), T0 + 20_000)).toBe('rejected'); // Lab D: close on the map, not in agreement on foot
    near(f.position, 37, 0);
  });

  it('an accepted estimate between rejected ones clears what was waiting', () => {
    const f = make();
    begin(f, -9, 0);
    f.update(est(30, 0), T0 + STEP); // rejected
    f.update(est(-8, 0), T0 + 2 * STEP); // accepted
    expect(f.update(est(30.5, 0), T0 + 3 * STEP)).toBe('rejected'); // not "agreeing" with the old rejected one
  });

  it('with the rule off two rejections restart whether or not they agree, as before', () => {
    const disagree = (rules) => {
      const f = make(rules);
      begin(f, -9, 0);
      f.update(est(37, 0), T0 + STEP); // 46 m away
      return { status: f.update(est(20, 0), T0 + 2 * STEP), position: f.position }; // 29 m away, and 17 m from the first
    };
    expect(disagree({}).status).toBe('rejected');
    near(disagree({}).position, -9, 0);
    expect(disagree({ reacquireOnAgreement: false }).status).toBe('reacquiring');
    near(disagree({ reacquireOnAgreement: false }).position, 20, 0);
  });
});

describe('the output is always on a corridor: the wall rule is built in', () => {
  it('never reports a position inside a room, inside a wall or off the floor, whatever it is fed', () => {
    const f = make();
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let shown = 0;
    for (let i = 0; i < 400; i++) {
      f.update(est(rnd() * 100 - 30, rnd() * 60 - 20, rnd()), T0 + i * STEP);
      if (f.position) {
        shown++;
        expect(onCorridor(f.position), `step ${i}`).toBe(true);
      }
    }
    expect(shown).toBeGreaterThan(0);
  });

  it('keeps every accepted correction on a corridor even when it crosses to another one', () => {
    const f = make();
    begin(f, 6, 7.9); // the new ladies restroom, on west_back
    expect(f.update(est(-9, 0), T0 + STEP)).toBe('tracking'); // 22.9 m on foot: round the corner
    expect(onCorridor(f.position)).toBe(true);
  });
});

describe('the gate judges WALKING distance, not straight-line distance', () => {
  const restroom = { x: 6, y: 7.9 }; // the new ladies restroom (W), at the end of the west back path
  const labD = { x: 11, y: 0 }; // Lab D/E's door, in the passage

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
    begin(f, -9, 0); // the junction by lift lobby A
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

  it('a second estimate in the labs that agrees with the first means the filter was lost, not the person: it restarts there', () => {
    const f = make();
    begin(f, 6, 7.9);
    expect(f.update(est(11, 0), T0 + STEP)).toBe('rejected');
    expect(f.update(est(11.5, 0), T0 + 2 * STEP)).toBe('reacquiring');
    near(f.position, 11.5, 0);
  });

  it('lets the walk out of the back path through, because it follows the corridors', () => {
    const f = make();
    begin(f, 6, 7.9);
    expect(f.update(est(-9, 7.9), T0 + STEP)).toBe('tracking'); // 15 m along the back path
    expect(f.update(est(-9, 0), T0 + 2 * STEP)).toBe('tracking'); // 7.9 m down the spine
    expect(f.update(est(11, 0), T0 + 3 * STEP)).toBe('tracking'); // 20 m along the passage
  });
});

// The new ladies restroom (W): in the survey, the first three estimates there came out in the
// labs (about 43 m away on foot), then good ones. Both rules, on and off, on that scenario.
describe('the new ladies restroom scenario', () => {
  const labs = [est(11, 0), est(11.5, 0), est(10.5, 0)]; // three early estimates in the labs
  const good = [est(6, 7.9), est(5.5, 7.9), est(6.3, 7.9)]; // then good ones, at the restroom
  const run = (rules, estimates = [...labs, ...good], step = STEP) => {
    const f = make(rules);
    return estimates.map((e, i) => {
      const status = f.update(e, T0 + i * step);
      return { status, at: f.position && { x: Math.round(f.position.x * 10) / 10, y: Math.round(f.position.y * 10) / 10 } };
    });
  };
  const statuses = (rows) => rows.map((r) => r.status);
  const atRestroom = (p) => p && Math.abs(p.y - 7.9) < 1;

  it('with both rules: nothing is shown for the first lab estimate; the labs are confirmed by the second; the good ones restart the track after two', () => {
    const rows = run();
    expect(statuses(rows)).toEqual(['confirming', 'tracking', 'tracking', 'rejected', 'reacquiring', 'tracking']);
    expect(rows[0].at).toBeNull(); // not shown
    expect(rows[2].at.y).toBeCloseTo(0, 6); // wrongly in the labs for steps 2 and 3
    expect(atRestroom(rows[3].at)).toBe(false); // the first good one is rejected: still in the labs
    expect(atRestroom(rows[4].at)).toBe(true); // the second good one agrees with it: the track restarts in the restroom
    expect(atRestroom(rows[5].at)).toBe(true);
  });

  it('with both rules off: the first lab estimate is shown straight away, and the recovery is the same two steps', () => {
    const rows = run({ confirmStart: false, reacquireOnAgreement: false });
    expect(statuses(rows)).toEqual(['tracking', 'tracking', 'tracking', 'rejected', 'reacquiring', 'tracking']);
    expect(rows[0].at).not.toBeNull(); // a (wrong) position shown at once
    expect(atRestroom(rows[4].at)).toBe(true);
  });

  it('a single stray lab estimate at the start is never shown with the rule on, and is with it off', () => {
    const stray = [est(11, 0), est(6, 7.9), est(5.5, 7.9), est(6.3, 7.9)]; // one lab outlier, then good
    const on = run({}, stray);
    expect(statuses(on)).toEqual(['confirming', 'confirming', 'tracking', 'tracking']);
    expect(on.every((r) => !r.at || atRestroom(r.at))).toBe(true); // nothing was ever shown in the labs
    const off = run({ confirmStart: false }, stray);
    expect(off[0].at.y).toBeCloseTo(0, 6); // shown in the labs
    expect(statuses(off)).toEqual(['tracking', 'rejected', 'reacquiring', 'tracking']);
  });

  it('good estimates that scatter do not restart the track on a coin-flip: they must agree with each other', () => {
    const scatter = [...labs, est(6, 7.9), est(-9, 15), est(37, 0)]; // good, then two stray ones that disagree
    const on = run({}, scatter, 10_000);
    expect(statuses(on).slice(3)).toEqual(['rejected', 'rejected', 'rejected']); // stays where it was
    const off = run({ reacquireOnAgreement: false }, scatter, 10_000);
    expect(statuses(off).slice(3)).toEqual(['rejected', 'reacquiring', 'rejected']); // before: restarted at a stray estimate
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
