import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import floor7Aps from '../src/data/floor7Aps.json';
import planDoc from '../floor7-inputs/floor7_plan.json';
import overrides from '../src/data/floor7ApsOverrides.json';
import {
  assignSessions, buildAnchors, campusOnly, fileShort, placeReadings, radioOf, readMapping, readSurvey,
} from '../scripts/lib/floor7Anchors.mjs';
import { buildPlan, floor7Plan as plan } from '../src/utils/floor7Plan.js';

// The real survey, the real name table and the real plan, together: what the build script does,
// checked, and the committed floor7Aps.json checked against a fresh build so it cannot go stale.
const dir = join(process.cwd(), 'floor7-inputs');
const read = (f) => readFileSync(join(dir, f), 'utf8');
const files = readdirSync(dir).filter((f) => /^wifi_survey_.*\.csv$/.test(f)).sort();
const mapping = readMapping(read('survey_name_to_plan_spot.csv'));
const raw = assignSessions(files.flatMap((f) => readSurvey(read(f), f)));
const { placed, dropped, held } = placeReadings(raw, mapping);
const campus = campusOnly(placed);
const drawn = buildPlan(planDoc, 1);
const midpoint = (a, b) => {
  const m = drawn.pointAlongWalk({ x: a[0], y: a[1] }, { x: b[0], y: b[1] }, 0.5);
  return [m.x, m.y];
};
const fresh = buildAnchors(campus, { overrides, planDoc, mapping, midpoint });
const scanOf = (file, point) => `wifi_survey_20261013_${file}.csv#${point}`;

describe('the survey and the name table', () => {
  it('has the three survey files', () => {
    expect(files.map(fileShort)).toEqual(['115710', '120055', '170507']);
  });

  it('leaves no survey name unmapped: placing every reading does not throw', () => {
    const names = new Set(raw.map((r) => r.spot));
    expect(names.size).toBe(58);
    for (const n of names) expect(mapping.has(n), n).toBe(true);
  });

  it('drops exactly the one tp 707 scan', () => {
    expect(dropped).toEqual([scanOf('115710', 6)]);
  });

  it('holds back exactly the two Staff Room scans', () => {
    expect([...held].sort()).toEqual([scanOf('170507', 102), scanOf('170507', 56)].sort());
  });

  it('uses 112 scans less the 1 dropped and the 2 held = 109', () => {
    expect(new Set(raw.map((r) => r.scan)).size).toBe(112);
    expect(new Set(placed.map((r) => r.scan)).size).toBe(109);
  });

  it('counts no scan twice: scan ids are unique across files, each with one timestamp', () => {
    const perScan = new Map();
    for (const r of raw) perScan.set(r.scan, new Set([...(perScan.get(r.scan) ?? []), r.time]));
    for (const times of perScan.values()) expect(times.size).toBe(1);
  });

  it('treats Computing Lab F at point 69 or later as Lab D/E: points 70, 72, 74 move, 61, 62, 64, 66 stay', () => {
    const labOf = (scan) => placed.find((r) => r.scan === scan).place;
    for (const p of [61, 62, 64, 66]) expect(labOf(scanOf('170507', p)), `point ${p}`).toBe('labC');
    for (const p of [70, 72, 74]) expect(labOf(scanOf('170507', p)), `point ${p}`).toBe('labD');
  });

  it('ignores GPS completely: no reading carries a position', () => {
    for (const r of raw.slice(0, 50)) expect(Object.keys(r).some((k) => /^(lat|lng|accuracy)/.test(k))).toBe(false);
  });

  it('splits the newest file into its morning (points 19 to 31) and afternoon scans', () => {
    const session = (point) => raw.find((r) => r.scan === scanOf('170507', point)).session;
    expect(session(19)).toBe('170507 morning');
    expect(session(31)).toBe('170507 morning');
    expect(session(32)).toBe('170507 afternoon');
    expect(session(109)).toBe('170507 afternoon');
    expect(raw.find((r) => r.scan === scanOf('115710', 1)).session).toBe('115710');
  });

  it('puts every named spot where the plan says it is', () => {
    const pointOf = (id) => planDoc.survey_spots.find((s) => s.place_id === id)?.point ?? planDoc.places.find((p) => p.id === id)?.front_point;
    for (const row of mapping.values()) {
      if (row.drop || row.placeId.startsWith('between:')) continue;
      const [x, y] = pointOf(row.placeId);
      expect([row.x, row.y], row.rawName).toEqual([x, y]);
    }
  });

  it('puts a midpoint row between its two rooms', () => {
    const between = [...mapping.values()].filter((r) => r.placeId.startsWith('between:'));
    expect(between.length).toBeGreaterThan(0);
    for (const row of between) {
      const [a, b] = row.placeId.slice(8).split(',').map((id) => planDoc.survey_spots.find((s) => s.place_id === id).point);
      expect(row.x).toBeCloseTo((a[0] + b[0]) / 2, 6);
      expect(row.y).toBeCloseTo((a[1] + b[1]) / 2, 6);
    }
  });
});

describe('the committed floor7Aps.json', () => {
  it('is what a fresh build gives (run node scripts/build-floor7-aps.mjs if this fails)', () => {
    const trimmed = fresh.map((r) => ({ ...r, heard: r.heard.slice(0, 6) }));
    expect(floor7Aps.radios).toEqual(JSON.parse(JSON.stringify(trimmed)));
    expect(floor7Aps.scans).toEqual({ used: 109, dropped: ['115710#6'], held: ['170507#56', '170507#102'] });
    expect(floor7Aps.kind).toBe('floor7-aps-v2');
  });

  it('has an overrides section, empty until the team moves a radio by hand', () => {
    expect(floor7Aps.overrides).toEqual({});
  });

  it('has 38 radios and puts each BSSID in exactly one of them', () => {
    expect(floor7Aps.radios).toHaveLength(38);
    const seen = new Set();
    for (const r of floor7Aps.radios) {
      for (const { bssid } of r.bssids) {
        expect(radioOf(bssid)).toBe(r.radio);
        expect(seen.has(bssid), bssid).toBe(false);
        seen.add(bssid);
      }
    }
  });

  it('only holds campus access points', () => {
    for (const r of floor7Aps.radios) expect(r.bssids.some((b) => ['SRMIST', 'SRMIST-UA'].includes(b.ssid)), r.radio).toBe(true);
  });

  it('places EVERY radio on a corridor of the plan, the midpoint ones too (walking midpoint)', () => {
    for (const r of floor7Aps.radios) expect(plan.snapToCorridor(r.x, r.y).distanceMoved, r.radio).toBeLessThan(1e-6);
  });

  it('puts a radio whose best two spots are on different corridors at the WALKING midpoint, not the straight-line one', () => {
    const at = (id) => floor7Aps.radios.find((r) => r.radio === id);
    // Room 706A (east spine) and the stairs beside lobby B (passage): up the spine 7.75 m, then 3.625 m west
    expect([at('54:f0:b1:3e:5b').x, at('54:f0:b1:3e:5b').y]).toEqual([33.38, 0]);
    // Computing Lab C (passage, x 17) and Room 705 (east spine): along the passage 20 m, then 5.25 m up the spine
    expect(at('d0:4d:c6:db:64').x).toBeCloseTo(17 + (20 + 5.25) / 2, 2);
    expect(at('d0:4d:c6:db:64').y).toBe(0);
    for (const id of ['54:f0:b1:3e:5b', 'd0:4d:c6:db:64']) expect(at(id).basis).toBe('tie');
  });

  it('keeps radios heard only faintly: the -80 dBm cut is off, so Room 704 keeps its anchors', () => {
    expect(floor7Aps.radios.filter((r) => r.heard[0][1] < -80).length).toBe(7);
    expect(floor7Aps.radios.filter((r) => r.place === 'r704')).toHaveLength(2);
  });

  it('anchors the radios heard best at the old ladies restroom there, and none at the disabled one', () => {
    const rL = floor7Aps.radios.find((r) => r.place === 'rL');
    expect([rL.x, rL.y]).toEqual([33.8, 7.9]);
    expect(floor7Aps.radios.filter((r) => r.place === 'rNew')).toEqual([]);
  });

  it('flags the radios heard at one spot only, both of Room 704\'s among them', () => {
    const single = floor7Aps.radios.filter((r) => r.single_spot).map((r) => r.radio);
    expect(single).toEqual(['48:b4:c3:72:0e', '54:f0:b1:3c:e2', '84:d4:7e:90:34', 'd0:4d:c6:e1:b6']);
    const at704 = floor7Aps.radios.filter((x) => x.place === 'r704');
    expect(at704).toHaveLength(2);
    for (const r of at704) {
      expect(r.single_spot).toBe(true);
      expect(r.guess).toContain('Room 704 position is a mirror guess');
    }
  });

  it('marks 19 anchors as resting on a guess, with the reason for each', () => {
    expect(floor7Aps.radios.filter((r) => r.guess.length > 0)).toHaveLength(19);
    for (const r of floor7Aps.radios.filter((x) => x.place === 'r702')) expect(r.guess).toContain('Room 702 position is a guess');
    for (const r of floor7Aps.radios.filter((x) => ['rL', 'rM', 'rNew', 'rW'].includes(x.place))) expect(r.guess.join()).toContain('restroom');
    for (const r of floor7Aps.radios.filter((x) => x.x === 37)) expect(r.guess.join(), r.radio).toContain('east wing');
    for (const r of floor7Aps.radios.filter((x) => x.guess.length === 0)) expect(r.x, r.radio).toBeLessThan(33);
  });
});
