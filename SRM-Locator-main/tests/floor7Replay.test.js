import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { accessPointTable } from '../src/utils/floor7ApTable.js';
import { toGeo } from '../src/utils/floor7Frame.js';
import { buildPlan, floor7Plan as plan } from '../src/utils/floor7Plan.js';
import planDoc from '../floor7-inputs/floor7_plan.json';
import { readMapping } from '../scripts/lib/floor7Anchors.mjs';
import { blindGuessWalk, evaluate, groupBy, scansOf, stats } from '../scripts/lib/floor7Replay.mjs';

const row = (walk, extra = {}) => ({ walk, ...extra });
const near = (v, e, d = 6) => expect(v).toBeCloseTo(e, d);

describe('stats', () => {
  it('takes the median, mean, nearest-rank 90th percentile and worst of the walking errors', () => {
    const s = stats([1, 2, 3, 4, 10].map((w) => row(w)));
    expect(s).toMatchObject({ scans: 5, estimated: 5, noEstimate: 0, median: 3, mean: 4, p90: 10, max: 10 });
    near(s.within5, 0.8);
    near(s.within10, 1);
  });

  it('takes the middle two of an even count', () => {
    expect(stats([1, 2, 3, 4].map((w) => row(w))).median).toBe(2.5);
  });

  it('counts scans with no estimate apart, not as zero error', () => {
    const s = stats([row(2), row(null), row(4)]);
    expect(s).toMatchObject({ scans: 3, estimated: 2, noEstimate: 1, median: 3 });
  });

  it('copes with nothing to measure', () => {
    expect(stats([row(null)])).toEqual({ scans: 1, noEstimate: 1, estimated: 0 });
    expect(stats([])).toEqual({ scans: 0, noEstimate: 0, estimated: 0 });
  });

  it('puts a walk of exactly 5 m inside "within 5 m"', () => {
    near(stats([row(5), row(5.01)]).within5, 0.5);
  });
});

describe('groupBy', () => {
  it('groups in first-seen order', () => {
    const g = groupBy([{ k: 'b', n: 1 }, { k: 'a', n: 2 }, { k: 'b', n: 3 }], (r) => r.k);
    expect([...g.keys()]).toEqual(['b', 'a']);
    expect(g.get('b').map((r) => r.n)).toEqual([1, 3]);
  });
});

describe('evaluate (leave one out)', () => {
  const rd = (scan, bssid, rssi, place, x, y, extra = {}) => ({ scan, file: 'f.csv', point: 1, phone: 'p1', part: 'morning', session: 'p1', bssid, ssid: 'SRMIST', rssi, place, x, y, ...extra });
  const R1 = 'aa:aa:aa:aa:aa';
  const placed = [
    rd('s1', `${R1}:01`, -50, 'r701', -9, 11.75),
    rd('s2', `${R1}:01`, -60, 'r704', 37, 11.75, { part: 'afternoon', session: 'p1 afternoon' }),
    rd('s2', 'bb:bb:bb:bb:bb:01', -70, 'r704', 37, 11.75, { part: 'afternoon', session: 'p1 afternoon' }),
  ];
  const scans = [...scansOf(placed).values()];
  const base = { campus: placed, scale: 1, plan };

  it('groups readings into scans, keeping the phone, part and spot', () => {
    expect(scans.map((s) => [s.scan, s.place, s.part, s.readings.length])).toEqual([['s1', 'r701', 'morning', 1], ['s2', 'r704', 'afternoon', 2]]);
  });

  it('builds each scan\'s anchors without that scan', () => {
    const seen = [];
    evaluate({ ...base, tests: scans, trainFor: (s) => (r) => r.scan !== s.scan, estimate: (s, radios) => (seen.push([s.scan, radios.map((r) => r.radio)]), null) });
    expect(seen).toEqual([['s1', [R1, 'bb:bb:bb:bb:bb']], ['s2', [R1]]]);
  });

  it('measures the walk from the snapped estimate to the real spot', () => {
    const [a, b] = evaluate({ ...base, tests: scans, trainFor: () => () => true, estimate: (s) => (s.scan === 's1' ? { x: 37, y: 11.75 } : { x: -14.2, y: 11.75 }) });
    near(a.walk, 69.5); // 701's truth is (-9, 11.75): from 704 it is 69.5 m on foot
    near(b.walk, 69.5);
    near(b.moved, 5.2); // the estimate was inside Room 701; snapping moved it 5.2 m
    near(b.straight, 51.2);
  });

  it('records a scan with no estimate as such', () => {
    const [a] = evaluate({ ...base, tests: scans, trainFor: () => () => true, estimate: () => null });
    expect(a).toMatchObject({ est: null, walk: null });
  });

  it('works in real metres: truth is the plan spot times the scale', () => {
    const doubled = buildPlan(planDoc, 2);
    const [a] = evaluate({ ...base, plan: doubled, scale: 2, tests: [scans[0]], trainFor: () => () => true, estimate: () => ({ x: -18, y: 23.5 }) });
    near(a.walk, 0);
  });

  it('marks a scan taken at a guess spot, and how much of its estimate rests on guesses', () => {
    const mapping = readMapping('raw_name,place_id,plan_x,plan_y,confidence\nx,r701,0,0,estimated\n');
    const guessy = { ...rd('s3', `${R1}:01`, -50, 'r702', -9, 5.25) };
    const [a, b] = evaluate({ ...base, planDoc, mapping, campus: [...placed, guessy], tests: [scans[0], ...scansOf([guessy]).values()], trainFor: () => () => true, estimate: () => ({ x: 0, y: 0 }) });
    expect(a.truthIsGuess).toBe(false);
    expect(b.truthIsGuess).toBe(true);
    expect(a.matchedRadios).toBe(1);
  });
});

describe('blindGuessWalk', () => {
  it('is the average walk between the distinct surveyed spots', () => {
    const scans = scansOf([
      { scan: 'a', place: 'r701', x: -9, y: 11.75, bssid: 'x', rssi: -50 },
      { scan: 'b', place: 'r704', x: 37, y: 11.75, bssid: 'x', rssi: -50 },
      { scan: 'c', place: 'r704', x: 37, y: 11.75, bssid: 'x', rssi: -50 },
    ]);
    const g = blindGuessWalk(scans, plan, 1);
    expect(g.spots).toBe(2);
    near(g.mean, 69.5);
  });
});

describe('the access point table the replay and the app share', () => {
  const radios = [{ radio: 'aa:aa:aa:aa:aa', x: 10, y: 4, bssids: [{ bssid: 'AA:AA:AA:AA:AA:01', ssid: 'SRMIST' }, { bssid: 'aa:aa:aa:aa:aa:02', ssid: '' }] }];

  it('keys by lowercase BSSID and puts every BSSID of a radio at its position, on Floor 7', () => {
    const table = accessPointTable(radios, 1);
    expect([...table.keys()]).toEqual(['aa:aa:aa:aa:aa:01', 'aa:aa:aa:aa:aa:02']);
    expect(table.get('aa:aa:aa:aa:aa:01')).toMatchObject({ building: 'TECH PARK', floor: 7, ambiguousFloor: false, ...toGeo(10, 4) });
  });

  it('applies PLAN_SCALE to the position', () => {
    expect(accessPointTable(radios, 1.5).get('aa:aa:aa:aa:aa:01')).toMatchObject(toGeo(15, 6));
  });
});

describe('the report script, end to end', () => {
  const out = mkdtempSync(join(tmpdir(), 'locus-floor7-report-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const stdout = execFileSync('node', ['scripts/floor7-leave-one-out.mjs'], {
    cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, FLOOR7_REPORT_DIR: out },
  });
  const report = readFileSync(join(out, 'leave_one_scan_out.md'), 'utf8');

  it('runs against the real estimator and plan, and writes the report it prints', () => {
    expect(report.trim()).toBe(stdout.trim());
  });

  it('says what went in: 109 scans, the dropped and the held ones, the four sessions', () => {
    expect(report).toContain('109 scans used');
    expect(report).toContain('Dropped: 115710#6');
    expect(report).toContain('170507#56, 170507#102');
    for (const s of ['115710: 9 scans', '120055: 11 scans', '170507 morning: 13 scans', '170507 afternoon: 76 scans']) expect(report).toContain(s);
  });

  it('gives leave-one-scan-out overall, for one-scan spots separately, and Room 704 on its own', () => {
    expect(report).toContain('## 1. Leave one scan out');
    expect(report).toContain('spots with exactly ONE scan');
    expect(report).toContain('### Spots with exactly one scan, listed separately');
    expect(report).toContain('### Room 704');
  });

  it('splits by session, including morning against afternoon', () => {
    expect(report).toContain('## 2. Split by session');
    expect(report).toMatch(/\| 170507 morning \| 13 \|/);
    expect(report).toMatch(/\| afternoon \| 76 \|/);
  });

  it('tests anchors from one session on another, in both directions, with unseen spots listed', () => {
    expect(report).toContain('## 3. Anchors built from one session, tested on another');
    for (const name of ['morning (all three phones) -> afternoon', 'afternoon -> morning (all three phones)', 'third phone, morning -> third phone, afternoon', 'the other two phones -> third phone', 'third phone (both parts) -> the other two phones']) {
      expect(report).toContain(name);
    }
    expect(report).toContain('spots unseen in training');
  });

  it('marks which anchors rest on a guess item, and prints the caveats', () => {
    expect(report).toContain('19 of 38 anchors rest on a guess item');
    expect(report).toContain('Room 702 position is a guess');
    expect(report).toContain('Room 704 position is a mirror guess');
    expect(report).toContain('## Caveats');
    expect(report).toContain('same people on the same day');
  });
});
