import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import planDoc from '../floor7-inputs/floor7_plan.json';
import { readMapping } from '../scripts/lib/floor7Anchors.mjs';
import {
  DEFAULT_DWELL_S, clockToEpoch, formatWalk, parseClock, parseDoors, parseFixLog, resolveDoor, scoreDoors,
} from '../scripts/lib/floor7PhoneWalk.mjs';
import { FIX_LOG_MARKER, createFloor7Tracker, floor7Spots } from '../src/utils/floor7Demo.js';
import { toGeo } from '../src/utils/floor7Frame.js';
import { PLAN_SCALE, floor7Plan as plan } from '../src/utils/floor7Plan.js';

const DAY = [2026, 10, 14];
const at = (clock, extra = 0) => clockToEpoch(...DAY, parseClock(clock)) + extra * 1000;
const fix = (clock, extra, over = {}) => ({
  at: at(clock, extra), status: 'tracking', x: -9, y: 9.75, rawX: -9, rawY: 9, snapX: -9, snapY: 15, unc: 4, ...over,
});
const line = (f) => `10-14 16:47:40.123  4242  4242 I Capacitor/Console: File: https://localhost/assets/index-a1b2.js - Line 1 - Msg: ${FIX_LOG_MARKER} ${JSON.stringify(f)}`;
const near = (v, e, d = 6) => expect(v).toBeCloseTo(e, d);

describe('reading the phone log', () => {
  it('takes the [F7] lines out of adb logcat output and ignores everything else', () => {
    const text = [
      '10-14 16:47:00.000  4242  4242 I Capacitor: something else',
      line(fix('16:47:40', 0)),
      '10-14 16:47:41.000  4242  4242 W Capacitor/Console: [WIFI] Fusion unavailable',
      line(fix('16:48:15', 0, { status: 'confirming', x: null, y: null })),
    ].join('\r\n');
    const fixes = parseFixLog(text);
    expect(fixes.map((f) => f.status)).toEqual(['tracking', 'confirming']);
    expect(fixes[1].x).toBeNull();
  });

  it('skips a line cut short, a line with no JSON, and repeats of the same estimate; sorts by time', () => {
    const a = fix('16:50:00', 0);
    const b = fix('16:49:00', 0);
    const text = [line(a), line(b), line(a), `Msg: ${FIX_LOG_MARKER} {"at": 12`, `Msg: ${FIX_LOG_MARKER} no json here`, `Msg: ${FIX_LOG_MARKER} {"at": "x", "status": 1}`].join('\n');
    expect(parseFixLog(text).map((f) => f.at)).toEqual([b.at, a.at]);
  });

  it('reads exactly what the app prints: the tracker\'s own console line', () => {
    const lines = [];
    const spy = vi.spyOn(console, 'info').mockImplementation((...a) => lines.push(a.join(' ')));
    const tracker = createFloor7Tracker({ staleMs: 70_000 });
    tracker.reset();
    const p = toGeo(floor7Spots['Room 701'].x, floor7Spots['Room 701'].y);
    const estimate = { ...p, building: 'TECH PARK', floor: 7, confidence: 0.9 };
    tracker.apply(estimate, 1_700_000_000_000);
    tracker.apply(estimate, 1_700_000_001_000);
    spy.mockRestore();
    const fixes = parseFixLog(lines.join('\n'));
    expect(fixes.map((f) => f.status)).toEqual(['confirming', 'tracking']);
    near(fixes[1].x, -9, 1);
    near(fixes[1].y, 11.75, 1);
  });
});

describe('the doors file', () => {
  it('reads door and time, with or without a header, and an optional dwell', () => {
    const doors = parseDoors('door,time\nRoom 701,16:47:10\nLift lobby A,16:51,90\n');
    expect(doors).toEqual([
      { door: 'Room 701', clockS: 16 * 3600 + 47 * 60 + 10, dwellS: DEFAULT_DWELL_S },
      { door: 'Lift lobby A', clockS: 16 * 3600 + 51 * 60, dwellS: 90 },
    ]);
    expect(parseDoors('Room 701,9:05\n')[0].clockS).toBe(9 * 3600 + 5 * 60);
  });

  it('refuses a time that is not one, naming the row', () => {
    expect(() => parseDoors('door,time\nRoom 701,quarter to five\n')).toThrow(/row 2.*quarter to five/);
    expect(() => parseDoors('Room 701,25:00\n')).toThrow(/not a time/);
    expect(() => parseDoors('Room 701,16:00,abc\n')).toThrow(/number of seconds/);
  });

  it('understands clock times', () => {
    expect(parseClock('16:47')).toBe(60420);
    expect(parseClock(' 16:47:10 ')).toBe(60430);
    expect(parseClock('16.47')).toBeNull();
    expect(parseClock('7:60')).toBeNull();
  });
});

describe('finding a door on the plan', () => {
  it('knows a place by its id, its name with or without the bracket, and the plan\'s other names for it', () => {
    for (const n of ['r706A', 'Room 706A', 'room 706a', 'Room 706A (staff room)', 'TP706A', 'staff room 706A']) {
      expect(resolveDoor(n, planDoc), n).toMatchObject({ x: 37, y: -7.75 });
    }
    expect(resolveDoor('Lab C', planDoc)).toMatchObject({ x: 17, y: 0 });
    expect(resolveDoor('new ladies restroom', planDoc)).toMatchObject({ x: 6, y: 7.9 });
  });

  it('also knows the names the survey used, through the name table', () => {
    const mapping = readMapping(readFileSync(join(process.cwd(), 'floor7-inputs', 'survey_name_to_plan_spot.csv'), 'utf8'));
    expect(resolveDoor('Near Toom 701', planDoc, mapping)).toMatchObject({ x: -9, y: 11.75 });
    expect(() => resolveDoor('tp 707', planDoc, mapping)).toThrow(/no door called/); // dropped: there is no such room
  });

  it('refuses a name that fits several places, naming them, and one it does not know, listing the ones it does', () => {
    expect(() => resolveDoor('lift area near Room 703', planDoc)).toThrow(/fits several places: .*Lift A1.*Lift lobby A/);
    expect(() => resolveDoor('Room 7O1', planDoc)).toThrow(/no door called "Room 7O1".*Room 701/);
  });
});

describe('scoring the doors', () => {
  const resolve = (n) => resolveDoor(n, planDoc);
  const score = (doors, fixes) => scoreDoors({ doors: parseDoors(doors), fixes, day: DAY, plan, scale: PLAN_SCALE, resolve });

  it('gives the walking error of the last position shown while you stood there, and of the raw estimate beside it', () => {
    // Room 701's door is at (-9, 11.75). Shown at (-9, 9.75): 2 m away. Raw snapped to (-9, 15): 3.25 m away.
    const [r] = score('Room 701,16:47:10\n', [fix('16:47:10', 40)]);
    expect(r).toMatchObject({ shown: true, status: 'tracking', fixesInWindow: 1 });
    near(r.walkM, 2);
    near(r.straightM, 2);
    near(r.rawWalkM, 3.25);
    near(r.secondsIn, 40);
  });

  it('measures on foot: a position on the back path is far from a door in the passage though close on the map', () => {
    // Lab D's door is at (11, 0); shown at the restroom door (6, 7.9): 9.3 m on the map, 42.9 m on foot.
    const [r] = score('Lab D,16:47:10\n', [fix('16:47:10', 30, { x: 6, y: 7.9, snapX: 11, snapY: 0 })]);
    near(r.straightM, Math.hypot(5, 7.9));
    near(r.walkM, 15 + 7.9 + 20);
    near(r.rawWalkM, 0);
  });

  it('uses the last position shown inside the window, not an earlier or a later one', () => {
    const fixes = [fix('16:47:10', -20, { y: 0 }), fix('16:47:10', 10, { y: 10 }), fix('16:47:10', 50, { y: 11.75 }), fix('16:47:10', 200, { y: 0 })];
    const [r] = score('Room 701,16:47:10\n', fixes);
    expect(r.fixesInWindow).toBe(2);
    near(r.walkM, 0);
    near(r.secondsIn, 50);
  });

  it('counts the window as the dwell: the default 75 s, or the third column', () => {
    expect(score('Room 701,16:47:10\n', [fix('16:47:10', 80)])[0].shown).toBe(false);
    expect(score('Room 701,16:47:10,100\n', [fix('16:47:10', 80)])[0].shown).toBe(true);
  });

  it('says so when no position was shown: nothing logged, or only a start still being confirmed', () => {
    const none = score('Room 701,16:47:10\n', [])[0];
    expect(none).toMatchObject({ shown: false, status: 'no estimate', fixesInWindow: 0 });
    const confirming = score('Room 701,16:47:10\n', [fix('16:47:10', 20, { status: 'confirming', x: null, y: null })])[0];
    expect(confirming).toMatchObject({ shown: false, status: 'confirming', fixesInWindow: 1 });
  });

  it('works in real metres: the door position is the plan\'s times PLAN_SCALE', () => {
    expect(PLAN_SCALE).toBe(1);
    const doubled = { ...plan, walkingDistance: (a, b) => plan.walkingDistance(a, b) };
    const [r] = scoreDoors({ doors: parseDoors('Room 701,16:47:10\n'), fixes: [fix('16:47:10', 10, { x: -18, y: 19.5, snapX: -18, snapY: 30 })], day: DAY, plan: doubled, scale: 1, resolve });
    expect(r.straightM).toBeGreaterThan(9); // (-18, 19.5) is far from (-9, 11.75)
    const [s] = scoreDoors({ doors: parseDoors('Room 701,16:47:10\n'), fixes: [fix('16:47:10', 10)], day: DAY, plan, scale: 2, resolve });
    expect(s.straightM).toBeGreaterThan(10); // the door is at (-18, 23.5) at scale 2
  });
});

describe('the printed table', () => {
  const resolve = (n) => resolveDoor(n, planDoc);
  const rows = scoreDoors({
    doors: parseDoors('Room 701,16:47:10\nLab D,16:50:00\nRoom 706A,16:55:00\n'),
    fixes: [fix('16:47:10', 40), fix('16:50:00', 30, { x: 6, y: 7.9, snapX: 11, snapY: 0 })],
    day: DAY, plan, scale: PLAN_SCALE, resolve,
  });
  const text = formatWalk(rows);

  it('has a line per door with its error, and says plainly when none was shown', () => {
    expect(text).toMatch(/Room 701.* 2\.0 m/);
    expect(text).toMatch(/Lab D.* 42\.9 m/);
    expect(text).toMatch(/Room 706A +0 .*no position shown/);
    expect(text).not.toContain('Room 706A (Room 706A');
  });

  it('ends with the median, mean, worst and how many doors were within 5 and 10 m, for the shown and the raw estimate', () => {
    expect(text).toContain('2 of 3 doors showed a position.');
    expect(text).toMatch(/shown error \(walk\): +median 22\.4 m, mean 22\.4 m, worst 42\.9 m, within 5 m: 1, within 10 m: 1/);
    expect(text).toMatch(/raw estimate \(walk\): +median 1\.6 m/);
  });

  it('tells you what to check when no door showed anything', () => {
    expect(formatWalk(scoreDoors({ doors: parseDoors('Room 701,16:47:10\n'), fixes: [], day: DAY, plan, scale: 1, resolve }))).toContain('No door showed a position');
  });
});

describe('the script, end to end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locus-floor7-walk-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const doors = join(dir, 'doors.csv');
  const log = join(dir, 'phone.log');
  const csv = join(dir, 'errors.csv');
  writeFileSync(doors, 'door,time\nRoom 701,16:47:10\nLab D,16:50:00\n');
  writeFileSync(log, [line(fix('16:47:10', 40)), line(fix('16:50:00', 30, { x: 6, y: 7.9, snapX: 11, snapY: 0 }))].join('\n'));
  const run = (...args) => spawnSync('node', ['scripts/floor7-phone-walk.mjs', ...args], { cwd: process.cwd(), encoding: 'utf8' });

  it('prints the error per door and writes a CSV', () => {
    const out = execFileSync('node', ['scripts/floor7-phone-walk.mjs', doors, log, '--date', '2026-10-14', '--csv', csv], { cwd: process.cwd(), encoding: 'utf8' });
    expect(out).toContain('2 estimates in the log');
    expect(out).toMatch(/Room 701.* 2\.0 m/);
    expect(out).toMatch(/Lab D.* 42\.9 m/);
    const rows = readFileSync(csv, 'utf8').trim().split('\n');
    expect(rows[0]).toBe('door,place,shown,status,fixes_in_window,seconds_in,walk_error_m,straight_error_m,raw_walk_error_m');
    expect(rows[1]).toMatch(/^Room 701,Room 701,true,tracking,1,40,2\.00,2\.00,3\.25$/);
  });

  it('takes the day from the first estimate when no --date is given', () => {
    expect(run(doors, log).stdout).toMatch(/Room 701.* 2\.0 m/);
  });

  it('fails with a plain message: no usage, no [F7] lines, a door it does not know', () => {
    expect(run().stderr).toContain('usage:');
    const empty = join(dir, 'empty.log');
    writeFileSync(empty, 'nothing here\n');
    expect(run(doors, empty).stderr).toContain('no "[F7] {...}" lines');
    const bad = join(dir, 'bad.csv');
    writeFileSync(bad, 'Room 7O1,16:47:10\n');
    const r = run(bad, log);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no door called "Room 7O1"');
  });
});
