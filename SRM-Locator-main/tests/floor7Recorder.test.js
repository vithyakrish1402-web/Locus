import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import planDoc from '../floor7-inputs/floor7_plan.json';
import { readSurvey } from '../scripts/lib/floor7Anchors.mjs';
import {
  ESTIMATE_COLUMNS, MARK_COLUMNS, SCAN_COLUMNS, parseEstimatesCsv, parseMarksCsv,
} from '../scripts/lib/floor7Recording.mjs';
import { CATCH_UP_M, scoreWalk } from '../scripts/lib/floor7PhoneWalk.mjs';

// The native plugin does not exist here: give the app's own recorder a memory store instead.
const memory = vi.hoisted(() => ({ dirs: new Map(), keepOn: null }));
vi.mock('../src/utils/floor7RecorderNative.js', () => ({
  recorderNative: {
    available: true,
    write: async (d, n, c) => { if (!memory.dirs.has(d)) memory.dirs.set(d, new Map()); memory.dirs.get(d).set(n, c); },
    read: async (d, n) => { const c = memory.dirs.get(d)?.get(n); if (c === undefined) throw new Error('NOT_FOUND'); return c; },
    list: async () => [...memory.dirs].map(([id]) => ({ id })),
    remove: async (d) => { memory.dirs.delete(d); },
    share: async () => {},
    saveToDownloads: async () => ({ saved: 0 }),
    keepScreenOn: async (on) => { memory.keepOn = on; },
  },
}));

const { CONSTANTS, PLAN_FINGERPRINT, createMemoryStore, createRecorder, isCampusReading, listPlaces, reportFromFiles, statusReason } = await import('../src/utils/floor7Recorder.js');
const { PLAN_SCALE, floor7Plan: plan } = await import('../src/utils/floor7Plan.js');

const T0 = Date.UTC(2026, 9, 14, 11, 0, 0);
let clock;
let timers;
let lifecycle;
const make = (store = createMemoryStore(), over = {}) => createRecorder({
  now: () => clock,
  store,
  meta: () => ({ phone: 'Test Phone', build: { branch: 'b', commit: 'c', version: '0' }, planFingerprint: PLAN_FINGERPRINT, planTitle: 'plan' }),
  setTimer: (fn) => { timers.push(fn); return timers.length; },
  clearTimer: () => { timers = []; },
  attachLifecycle: (cb) => { lifecycle = cb; return () => { lifecycle = null; }; },
  ...over,
});

const aps = [
  { bssid: 'AA:BB:CC:00:00:01', ssid: 'SRMIST', rssi: -60, frequency: 2412 },
  { bssid: 'AA:BB:CC:00:00:02', ssid: 'SRMIST-UA', rssi: -70, frequency: 5180 },
  { bssid: 'de:ad:be:ef:00:03', ssid: 'HomeWifi', rssi: -50, frequency: 2437 }, // not campus
];
const estimate = (at, over = {}) => ({
  at, raw: { x: -9, y: 5 }, snapped: { x: -9, y: 5, edge: 3, offset: 1.5 }, filtered: { x: -9, y: 6 }, status: 'tracking',
  unc: 4.5, confidence: 0.8, matched: 4, total: 12, walkFromLastM: 1.2, scans: [{ at: at - 1000, aps }], ...over,
});
const rowsOf = (text) => text.trim().split('\n').map((l) => l.split(','));

beforeEach(() => { clock = T0; timers = []; lifecycle = null; memory.dirs.clear(); memory.keepOn = null; });
afterEach(() => vi.restoreAllMocks());

describe('nothing is recorded before Start or after Stop', () => {
  it('ignores everything and writes nothing until Start', () => {
    const store = createMemoryStore();
    const r = make(store);
    r.recordEstimate(estimate(T0));
    r.markDoor('r701');
    r.markWalk('start', 'r701');
    r.recordCycle('scan-error', 'x');
    r.onForeground(false);
    expect(r.recording).toBe(false);
    expect(r.snapshot().recording).toBe(false);
    expect(store.state.keepOn).toBe(false);
    return store.list().then((l) => expect(l).toEqual([]));
  });

  it('stops storing at Stop: later estimates change no file', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    r.recordEstimate(estimate(T0 + 1000));
    const out = await r.stop();
    const before = await store.read(id, `${id}_estimates.csv`);
    clock += 5000;
    r.recordEstimate(estimate(T0 + 9000));
    r.markDoor('r701');
    await new Promise((res) => setTimeout(res, 5));
    expect(await store.read(id, `${id}_estimates.csv`)).toBe(before);
    expect(rowsOf(before)).toHaveLength(2); // header + one
    expect(out.files).toHaveLength(5);
  });

  it('keeps the screen on while recording and lets go at Stop', async () => {
    const store = createMemoryStore();
    const r = make(store);
    r.start();
    expect(store.state.keepOn).toBe(true);
    await r.stop();
    expect(store.state.keepOn).toBe(false);
  });
});

describe('separate recordings', () => {
  it('two recordings have their own id, files and rows', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const a = r.start();
    r.recordEstimate(estimate(T0 + 1000));
    await r.stop();
    clock += 60_000;
    const b = r.start();
    r.recordEstimate(estimate(clock + 1000));
    r.recordEstimate(estimate(clock + 2000));
    await r.stop();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^floor7_\d{8}_\d{6}$/);
    expect(rowsOf(await store.read(a, `${a}_estimates.csv`))).toHaveLength(2);
    expect(rowsOf(await store.read(b, `${b}_estimates.csv`))).toHaveLength(3);
    expect((await r.recordings()).map((x) => x.id).sort()).toEqual([a, b].sort());
  });

  it('can delete one without touching the other', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const a = r.start();
    await r.stop();
    clock += 60_000;
    const b = r.start();
    await r.stop();
    await r.remove(a);
    expect((await r.recordings()).map((x) => x.id)).toEqual([b]);
  });
});

describe('the files', () => {
  it('estimates.csv: the agreed columns, one row per estimate, "none" when no position was shown, status words', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    r.recordEstimate(estimate(T0 + 1000));
    r.recordEstimate(estimate(T0 + 36_000, { filtered: null, status: 'confirming', walkFromLastM: null }));
    r.recordEstimate(estimate(T0 + 71_000, { status: 'rejected', walkFromLastM: 40.04 }));
    r.recordEstimate(estimate(T0 + 106_000, { status: 'reacquiring' }));
    await r.stop();
    const rows = rowsOf(await store.read(id, `${id}_estimates.csv`));
    expect(rows[0]).toEqual(ESTIMATE_COLUMNS);
    expect(rows).toHaveLength(5);
    const col = (row, name) => row[ESTIMATE_COLUMNS.indexOf(name)];
    expect(col(rows[1], 'at_ms')).toBe(String(T0 + 1000));
    expect(col(rows[1], 'time')).toBe(new Date(T0 + 1000).toISOString()); // with milliseconds
    expect(col(rows[1], 'shown')).toBe('position');
    expect([col(rows[1], 'snap_edge'), col(rows[1], 'snap_offset_m'), col(rows[1], 'matched_aps'), col(rows[1], 'total_aps'), col(rows[1], 'scans_merged')]).toEqual(['3', '1.5', '4', '12', '1']);
    expect(rows.slice(1).map((x) => col(x, 'status'))).toEqual(['tracking', 'waiting', 'rejected', 'reacquiring']);
    expect(col(rows[2], 'shown')).toBe('none');
    expect(col(rows[2], 'filtered_x')).toBe('');
    expect(rows[3].join(',')).toContain('40 m'.slice(0, 0)); // reason is quoted below
    expect(await store.read(id, `${id}_estimates.csv`)).toContain('40.0 m walk');
  });

  it('scans.csv: the campus readings only, each scan once even when the next estimate re-uses it', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    r.recordEstimate(estimate(T0 + 1000, { scans: [{ at: 500, aps }] }));
    r.recordEstimate(estimate(T0 + 36_000, { scans: [{ at: 500, aps }, { at: 35_500, aps }] }));
    await r.stop();
    const rows = rowsOf(await store.read(id, `${id}_scans.csv`));
    expect(rows[0]).toEqual(SCAN_COLUMNS);
    expect(rows).toHaveLength(1 + 2 * 2); // two scans, two campus readings each
    expect(rows.map((x) => x[2])).not.toContain('de:ad:be:ef:00:03');
    expect(rows[1][2]).toBe('aa:bb:cc:00:00:01'); // lower-cased
    expect(rows[1].slice(3)).toEqual(['SRMIST', '-60', '2412']);
    const est = rowsOf(await store.read(id, `${id}_estimates.csv`));
    expect(est[2][ESTIMATE_COLUMNS.indexOf('scans_used')]).toBe('500;35500');
    expect(est[2][ESTIMATE_COLUMNS.indexOf('scans_merged')]).toBe('2');
  });

  it('knows a campus reading by its network name or by being in the bundled table', () => {
    expect(isCampusReading({ bssid: 'x', ssid: 'SRMIST' })).toBe(true);
    expect(isCampusReading({ bssid: 'x', ssid: 'HomeWifi' })).toBe(false);
    expect(isCampusReading({ bssid: '34:3A:20:8D:8A:C0', ssid: '' })).toBe(true); // a hidden campus radio
  });

  it('summary.txt: phone, build, plan, every constant in force, the privacy note and the error report', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    await r.stop();
    const text = await store.read(id, `${id}_summary.txt`);
    expect(text).toContain('Test Phone');
    expect(text).toContain('"branch":"b"');
    expect(text).toContain(`fingerprint ${PLAN_FINGERPRINT}`);
    for (const [k, v] of Object.entries(CONSTANTS)) expect(text, k).toContain(`${k} = ${v}`);
    for (const k of ['PLAN_SCALE', 'MAX_JUMP_M', 'REACQUIRE_AFTER_REJECTS', 'CONFIRM_WITHIN_M']) expect(Object.keys(CONSTANTS)).toContain(k);
    expect(text).toContain('Wi-Fi names and hardware addresses');
    expect(text).toContain('ERROR REPORT');
  });

  it('explains each status in words', () => {
    expect(statusReason('tracking', 2)).toBe('');
    expect(statusReason('waiting', null)).toMatch(/second estimate/);
    expect(statusReason('rejected', 31.26)).toMatch(/31\.3 m walk.*cap 25 m/);
    expect(statusReason('reacquiring', 1)).toMatch(/agreed with each other/);
  });
});

describe('door marks', () => {
  it('stores the place id and the exact time of the tap; Done ends the dwell early; the default is 75 s', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    clock = T0 + 10_000;
    r.markDoor('r701');
    clock = T0 + 40_000;
    r.doneDoor();
    clock = T0 + 50_000;
    r.markDoor('r706A');
    clock = T0 + 200_000;
    await r.stop();
    const rows = rowsOf(await store.read(id, `${id}_doors.csv`));
    expect(rows[0]).toEqual(MARK_COLUMNS);
    expect(rows[1].slice(0, 4)).toEqual(['door', 'r701', 'Room 701', String(T0 + 10_000)]);
    expect(rows[1][5]).toBe('30');
    expect(rows[2].slice(1, 4)).toEqual(['r706A', 'Room 706A (staff room)', String(T0 + 50_000)]);
    expect(rows[2][5]).toBe('75'); // never Done: the default
  });

  it('a new tap ends the previous door; Stop ends the last one; undo removes the last mark', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    clock = T0 + 1000;
    r.markDoor('r701');
    clock = T0 + 21_000;
    r.markDoor('r704');
    clock = T0 + 31_000;
    r.markDoor('r706A');
    r.undoMark();
    expect(r.snapshot().marks.map((m) => m.placeId)).toEqual(['r701', 'r704']);
    clock = T0 + 41_000;
    await r.stop();
    const rows = rowsOf(await store.read(id, `${id}_doors.csv`));
    expect(rows.slice(1).map((x) => x[5])).toEqual(['20', '20']); // r701 until the next tap; r704 until Stop (Undo of r706A put r704 back in progress)
  });

  it('shows the countdown for the current door and clears it on Done', () => {
    const r = make();
    r.start();
    r.markDoor('r701');
    expect(r.snapshot().current).toEqual({ placeName: 'Room 701', secondsLeft: 75 });
    clock += 30_000;
    expect(r.snapshot().current.secondsLeft).toBe(45);
    r.doneDoor();
    expect(r.snapshot().current).toBeNull();
  });

  it('lists the plan places with their other names, so Room 706A and TP706A both find it', () => {
    const places = listPlaces();
    const find = (q) => places.filter((p) => p.search.includes(q.toLowerCase())).map((p) => p.id);
    expect(find('TP706A')).toContain('r706A');
    expect(find('Room 706A')).toContain('r706A');
    expect(places.every((p) => planDoc.places.find((x) => x.id === p.id).front_point)).toBe(true);
  });

  it('refuses a place that is not on the plan', () => {
    const r = make();
    r.start();
    expect(() => r.markDoor('nope')).toThrow(/unknown place/);
  });

  it('pairs start-of-walk and end-of-walk marks', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    clock = T0 + 1000;
    r.markWalk('start', 'r701');
    expect(r.snapshot().openWalkStart.placeId).toBe('r701');
    clock = T0 + 61_000;
    r.markWalk('end', 'r706A');
    expect(r.snapshot().openWalkStart).toBeNull();
    await r.stop();
    const { walks, windows } = parseMarksCsv(await store.read(id, `${id}_doors.csv`));
    expect(windows).toEqual([]);
    expect(walks).toHaveLength(1);
    expect([walks[0].start.key, walks[0].end.key, walks[0].end.at - walks[0].start.at]).toEqual(['r701', 'r706A', 60_000]);
  });
});

describe('auto-save and recovery', () => {
  it('saves again every interval while recording, so a crash loses at most that much', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    await new Promise((res) => setTimeout(res, 5));
    r.recordEstimate(estimate(T0 + 1000));
    expect(rowsOf(await store.read(id, `${id}_estimates.csv`))).toHaveLength(1); // not saved yet
    expect(timers).toHaveLength(1);
    clock += 10_000;
    timers[0]();
    await new Promise((res) => setTimeout(res, 5));
    expect(rowsOf(await store.read(id, `${id}_estimates.csv`))).toHaveLength(2);
  });

  it('after a simulated kill, the next open offers the recording and recovers it up to the last save', async () => {
    const store = createMemoryStore();
    const first = make(store);
    const id = first.start();
    first.recordEstimate(estimate(T0 + 1000));
    first.markDoor('r701');
    clock += 10_000;
    timers[0]();
    await new Promise((res) => setTimeout(res, 5));
    first.recordEstimate(estimate(T0 + 2000)); // after the last save: lost with the app
    // the app is killed here: a fresh recorder over the same files
    const second = make(store);
    const offered = await second.recoverable();
    expect(offered.map((o) => o.id)).toEqual([id]);
    expect(offered[0].estimates).toBe(1);
    const out = await second.recover(id);
    expect(out.files).toHaveLength(5);
    expect(await store.read(id, `${id}_events.csv`)).toContain('recovered_after_app_closed');
    expect(await store.read(id, `${id}_summary.txt`)).toContain('status: recovered');
    expect(await second.recoverable()).toEqual([]);
    expect(rowsOf(await store.read(id, `${id}_doors.csv`))).toHaveLength(2);
  });

  it('does not offer a finished recording, nor the one that is running', async () => {
    const store = createMemoryStore();
    const r = make(store);
    r.start();
    await new Promise((res) => setTimeout(res, 5));
    expect(await r.recoverable()).toEqual([]); // running
    await r.stop();
    expect(await r.recoverable()).toEqual([]); // done
  });
});

describe('leaving the foreground', () => {
  it('records when the app left and came back, and warns on return with how long', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    clock = T0 + 5000;
    lifecycle(false);
    expect(r.snapshot().warning).toMatchObject({ leftAt: T0 + 5000, seconds: null });
    clock = T0 + 25_000;
    lifecycle(true);
    expect(r.snapshot().warning).toMatchObject({ seconds: 20, count: 1 });
    r.dismissWarning();
    expect(r.snapshot().warning).toBeNull();
    await r.stop();
    const events = rowsOf(await store.read(id, `${id}_events.csv`)).slice(1).map((x) => [x[0], x[2]]);
    expect(events).toEqual([[String(T0), 'start'], [String(T0 + 5000), 'left_foreground'], [String(T0 + 25_000), 'returned_to_foreground'], [String(T0 + 25_000), 'stop']]);
    expect(await store.read(id, `${id}_summary.txt`)).toContain('WARNING: the app left the foreground');
  });

  it('stops listening at Stop', async () => {
    const r = make();
    r.start();
    expect(lifecycle).toBeTypeOf('function');
    await r.stop();
    expect(lifecycle).toBeNull();
  });

  it('notes cycles that gave no estimate, but not the ones that did', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    r.recordCycle('throttled');
    r.recordCycle('estimate');
    await r.stop();
    const text = await store.read(id, `${id}_events.csv`);
    expect(text).toContain('cycle_throttled');
    expect(text).not.toContain('cycle_estimate');
  });
});

describe('the continuous walk', () => {
  const at = (s) => T0 + s * 1000;
  const fix = (s, x, y) => ({ at: at(s), status: 'tracking', x, y });
  const resolve = () => ({ name: 'Room 706A', x: 37, y: -7.75 }); // east spine
  const walk = { start: { label: 'Room 701', key: 'r701', at: at(0) }, end: { label: 'Room 706A', key: 'r706A', at: at(100) } };
  const base = { plan, scale: PLAN_SCALE, resolve, walk };

  it('measures how far behind the dot was at the end, and how long it took to catch up', () => {
    const fixes = [fix(30, -9, 10), fix(95, 37, 30), fix(130, 37, 10), fix(150, 37, -1), fix(165, 37, -7.75)]; // +150 s is 6.75 m off: not yet
    const r = scoreWalk({ ...base, fixes });
    expect(r.shown).toBe(true);
    expect(r.lagM).toBeCloseTo(plan.walkingDistance({ x: 37, y: 30 }, { x: 37, y: -7.75 }), 6);
    expect(r.lagM).toBeGreaterThan(CATCH_UP_M);
    expect(r.catchUpS).toBe(65); // the fix at +165 s is the first within 5 m
  });

  it('is zero when the dot had already arrived, and null when it never catches up', () => {
    expect(scoreWalk({ ...base, fixes: [fix(95, 37, -7)] }).catchUpS).toBe(0);
    expect(scoreWalk({ ...base, fixes: [fix(95, 37, 30), fix(140, 37, 25)] }).catchUpS).toBeNull();
  });

  it('says so when no position was shown during the walk', () => {
    expect(scoreWalk({ ...base, fixes: [{ at: at(50), status: 'waiting', x: null, y: null }] }).shown).toBe(false);
  });
});

describe('the same numbers on the phone and on a PC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'locus-rec-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('the script, run on the shared files, prints the very report the phone showed', async () => {
    const store = createMemoryStore();
    const r = make(store);
    const id = r.start();
    // Room 701's front point is (-9, 11.75): estimates near it, then one far away at Room 706A's door.
    for (let i = 0; i < 4; i++) r.recordEstimate(estimate(T0 + (i + 1) * 20_000, { filtered: { x: -9, y: 11.75 + i }, raw: { x: -9, y: 11 + i }, snapped: { x: -9, y: 11 + i, edge: 0, offset: 1 } }));
    clock = T0 + 10_000;
    r.markDoor('r701');
    clock = T0 + 90_000;
    r.markDoor('r706A');
    clock = T0 + 200_000;
    r.markWalk('start', 'r701');
    clock = T0 + 260_000;
    r.markWalk('end', 'r706A');
    const out = await r.stop();
    for (const name of out.files) writeFileSync(join(dir, name), await store.read(id, name));
    const stdout = execFileSync(process.execPath, ['scripts/floor7-phone-walk.mjs', join(dir, `${id}_estimates.csv`)], { encoding: 'utf8' });
    expect(stdout).toContain(out.report.text);
    expect(out.report.text).toContain('What this means');
    expect(out.report.text).toContain('Room 701');
    // and given in the other order, or with the old log + hand-written doors: still works
    const swapped = execFileSync(process.execPath, ['scripts/floor7-phone-walk.mjs', join(dir, `${id}_doors.csv`), join(dir, `${id}_estimates.csv`)], { encoding: 'utf8' });
    expect(swapped).toContain(out.report.text);
  });

  it('the report text is computed from the files, so a hand-edited doors file changes it', async () => {
    const estimatesText = 'at_ms,time,raw_x,raw_y,snap_edge,snap_offset_m,snap_x,snap_y,filtered_x,filtered_y,shown,status,reason,walk_from_last_m,confidence,matched_aps,total_aps,scans_merged,scans_used,uncertainty_m\n'
      + `${T0},${new Date(T0).toISOString()},-9,11,0,1,-9,11,-9,11.75,position,tracking,,,0.8,4,12,1,,4\n`;
    const marks = (id) => `kind,place_id,place_name,at_ms,time,dwell_s\ndoor,${id},x,${T0 - 1000},t,75\n`;
    const a = reportFromFiles({ estimatesText, marksText: marks('r701') });
    const b = reportFromFiles({ estimatesText, marksText: marks('r706A') });
    expect(a.doorRows[0].walkM).toBeCloseTo(0, 6);
    expect(b.doorRows[0].walkM).toBeGreaterThan(30);
    expect(parseEstimatesCsv(estimatesText)[0]).toMatchObject({ x: -9, y: 11.75, status: 'tracking' });
  });
});

describe('replaying the Floor 7 survey through the real tracker as if it were a live walk', () => {
  it('writes files for every estimate, scores the doors, and changes nothing the tracker returns', async () => {
    const { estimatePosition } = await import('../src/utils/wifiPositioning.js');
    const { floor7AccessPointTable, createFloor7Tracker } = await import('../src/utils/floor7Demo.js');
    const { recorder: app } = await import('../src/utils/floor7Recorder.js');
    const survey = readSurvey(readFileSync('floor7-inputs/wifi_survey_20261013_170507.csv', 'utf8'), 'wifi_survey_20261013_170507.csv');
    const scans = [...Map.groupBy(survey, (r) => r.scan)].map(([scan, rs]) => ({
      scan, at: rs[0].time, spot: rs[0].spot,
      aps: rs.map((r) => ({ bssid: r.bssid, ssid: r.ssid, rssi: r.rssi, frequency: 5000 })),
    })).sort((a, b) => a.at - b.at);
    expect(scans.length).toBeGreaterThan(10);
    const table = floor7AccessPointTable();
    const places = listPlaces();
    const placeOf = (spot) => places.find((p) => p.names.includes(spot))?.id;

    const run = (recording) => {
      const tracker = createFloor7Tracker({ staleMs: 70_000 });
      tracker.reset();
      const shown = [];
      const buffer = [];
      let marked = null;
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        if (recording) { vi.setSystemTime(scans[0].at - 1000); app.start(); }
        for (const s of scans) {
          vi.setSystemTime(s.at);
          buffer.push({ at: s.at, aps: s.aps });
          if (buffer.length > 3) buffer.shift();
          const est = estimatePosition(buffer.map((b) => b.aps), table);
          if (recording && s.spot !== marked && placeOf(s.spot)) {
            if (marked) app.doneDoor();
            app.markDoor(placeOf(s.spot));
            marked = s.spot;
          }
          shown.push(tracker.apply({ ...est, building: 'TECH PARK', floor: 7 }, s.at, [...buffer]));
        }
        if (recording) app.doneDoor();
      } finally { vi.useRealTimers(); }
      return shown;
    };

    const without = run(false);
    expect(memory.dirs.size).toBe(0); // not recording: nothing stored at all
    const withRec = run(true);
    // observe only: every estimate the tracker returned is identical with and without the recorder
    expect(withRec).toEqual(without);
    const result = await app.stop();
    const id = result.id;
    const files = memory.dirs.get(id);
    const est = parseEstimatesCsv(files.get(`${id}_estimates.csv`));
    expect(est).toHaveLength(scans.length);
    expect(rowsOf(files.get(`${id}_scans.csv`)).length - 1).toBeGreaterThan(scans.length);
    expect(files.get(`${id}_summary.txt`)).toContain('ERROR REPORT');
    const doorCount = rowsOf(files.get(`${id}_doors.csv`)).length - 1;
    expect(doorCount).toBeGreaterThan(5);
    expect(result.report.doorRows).toHaveLength(doorCount);
    expect(result.report.doorRows.some((d) => d.shown)).toBe(true);
    // the recorded filtered positions are the tracker's: same count of shown positions
    expect(est.filter((e) => e.x !== null).length).toBe(without.filter((e) => e.lat !== null).length);
    expect(memory.keepOn).toBe(false);
  });
});

describe('wiring into the fusion loop', () => {
  it('the loop hands the tracker the scans each estimate was made from, and the recorder is told of cycles that gave none', async () => {
    const { startWifiFusion } = await import('../src/utils/wifiFusion.js');
    const { floor7FusionOptions } = await import('../src/utils/floor7Demo.js');
    const calls = [];
    let t = 1_000_000;
    const reading = (bssid) => [{ bssid, ssid: 'SRMIST', rssi: -50, frequency: 2412 }];
    let n = 0;
    const fusion = startWifiFusion({
      scan: async () => ({ accepted: true, aps: reading(`aa:aa:aa:aa:aa:0${++n}`) }),
      estimate: async () => ({ lat: 1, lng: 1, confidence: 0.9, building: 'X', floor: 1 }),
      floorsFor: async () => [],
      now: () => t,
      intervalMs: 1e9,
      tracker: { apply: (e, at, scans) => { calls.push({ at, scans: scans.map((s) => s.aps[0].bssid) }); return e; } },
    });
    await fusion.runCycle();
    t += 40_000;
    await fusion.runCycle();
    fusion.stop();
    expect(calls).toEqual([
      { at: 1_000_000, scans: ['aa:aa:aa:aa:aa:01'] },
      { at: 1_040_000, scans: ['aa:aa:aa:aa:aa:01', 'aa:aa:aa:aa:aa:02'] },
    ]);
    expect(floor7FusionOptions().onCycle).toBeTypeOf('function');
  });
});
