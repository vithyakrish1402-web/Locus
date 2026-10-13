import { describe, expect, it } from 'vitest';
import {
  TIE_DB, anchorRadios, campusOnly, parseCsv, radioOf, readSurvey, spotKey,
} from '../scripts/lib/floor7Anchors.mjs';

const spots = { 'Room 703': [10, 5], 'Room 702': [0, 5], 'TP706': [-20, -5], 'Lift near TP706': [-32, 0] };

const HEADER = 'point_id,timestamp,lat,lng,accuracy_m,bssid,ssid,rssi,frequency_mhz,building,floor,spot';
const csvRow = (id, bssid, ssid, rssi, spot) => `${id},t,1,2,3,${bssid},${ssid},${rssi},5180,TECH PARK,7,${spot}`;
const reading = (scan, bssid, ssid, rssi, spot) => ({ scan, bssid, ssid, rssi, spot });

describe('spot names', () => {
  it('treats spelling variants of one place as one spot', () => {
    expect(spotKey('Room703')).toBe(spotKey('Room 703'));
    expect(spotKey('room 703')).toBe(spotKey('ROOM703'));
    expect(spotKey('tp 706 a')).toBe(spotKey('TP706'));
    expect(spotKey('lift near tp 706')).toBe(spotKey('Lift near TP706'));
  });

  it('keeps 703 and 703A apart', () => {
    expect(spotKey('Room 703A')).not.toBe(spotKey('Room 703'));
  });
});

describe('reading the survey CSV', () => {
  it('parses quoted fields with commas, quotes and newlines', () => {
    expect(parseCsv('a,"b,c","d ""e""",f\r\n"x\ny",2\n')).toEqual([['a', 'b,c', 'd "e"', 'f'], ['x\ny', '2']]);
  });

  it('skips blank and all-comma rows, and keys scans by file so restarted ids do not collide', () => {
    const text = [HEADER, csvRow(1, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'TP706'), ',,,,,,,,,,,', '', ',,,,,,,,,,,'].join('\r\n');
    const a = readSurvey(text, 'one.csv');
    const b = readSurvey(text, 'two.csv');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ bssid: 'aa:aa:aa:aa:aa:01', rssi: -50, spot: 'TP706' });
    expect(a[0].scan).not.toBe(b[0].scan);
  });

  it('skips a row that has no BSSID even when other fields are filled in', () => {
    const text = [HEADER, csvRow(1, 'aa:aa:aa:aa:aa:01', 'SRMIST', -50, 'TP706'), '2,t,1,2,3,,,,,TECH PARK,7,TP706'].join('\n');
    expect(readSurvey(text, 'x.csv').map((r) => r.bssid)).toEqual(['aa:aa:aa:aa:aa:01']);
  });

  it('refuses a file without the columns it needs', () => {
    expect(() => readSurvey('foo,bar\n1,2\n', 'x.csv')).toThrow(/no "point_id" column/);
  });
});

describe('campus filter', () => {
  const rs = [
    reading('s#1', 'aa:bb:cc:dd:ee:01', 'SRMIST', -50, 'TP706'),
    reading('s#1', 'aa:bb:cc:dd:ee:02', '', -52, 'TP706'), // hidden name, same radio as a named one
    reading('s#1', 'aa:bb:cc:dd:ee:03', 'SRMIST-UA', -53, 'TP706'),
    reading('s#1', '11:22:33:44:55:01', 'Priya iPhone', -40, 'TP706'),
    reading('s#1', '99:88:77:66:55:01', '', -45, 'TP706'), // hidden, nothing campus alongside it
  ];

  it('keeps allowlisted names and the hidden-name radios that share their first five bytes', () => {
    expect(campusOnly(rs).map((r) => r.bssid)).toEqual(['aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:02', 'aa:bb:cc:dd:ee:03']);
  });

  it('drops phones and hidden networks that belong to no campus radio', () => {
    expect(campusOnly(rs).some((r) => r.ssid === 'Priya iPhone' || r.bssid.startsWith('99:'))).toBe(false);
  });

  it('groups a radio by its first five bytes', () => {
    expect(radioOf('AA:BB:CC:DD:EE:0F')).toBe('aa:bb:cc:dd:ee');
  });
});

describe('placing radios at spots', () => {
  const R = 'aa:bb:cc:dd:ee';

  it('puts a radio at the spot where it was heard strongest', () => {
    const [r] = anchorRadios(
      [reading('s#1', `${R}:01`, 'SRMIST', -70, 'Room 702'), reading('s#2', `${R}:01`, 'SRMIST', -50, 'Room703')],
      spots
    );
    expect(r).toMatchObject({ radio: R, x: 10, y: 5, spot: 'Room 703', basis: 'best' });
  });

  it('shares all of a radio\'s BSSIDs one position, taking the strongest of any of them', () => {
    const [r] = anchorRadios(
      [reading('s#1', `${R}:01`, 'SRMIST', -80, 'Room 702'), reading('s#2', `${R}:02`, '', -45, 'Room 703')],
      spots
    );
    expect(r.spot).toBe('Room 703');
    expect(r.bssids.map((b) => b.bssid)).toEqual([`${R}:01`, `${R}:02`]);
  });

  it('puts a radio between two spots when they are within the tie margin', () => {
    const [r] = anchorRadios(
      [reading('s#1', `${R}:01`, 'SRMIST', -50, 'Room 703'), reading('s#2', `${R}:01`, 'SRMIST', -50 - (TIE_DB - 1), 'Room 702')],
      spots
    );
    expect(r).toMatchObject({ x: 5, y: 5, spot: null, basis: 'tie' });
    expect(r.tie).toEqual(['Room 703', 'Room 702']);
  });

  it('a lead of exactly the tie margin is not a tie', () => {
    const [r] = anchorRadios(
      [reading('s#1', `${R}:01`, 'SRMIST', -50, 'Room 703'), reading('s#2', `${R}:01`, 'SRMIST', -50 - TIE_DB, 'Room 702')],
      spots
    );
    expect(r.basis).toBe('best');
  });

  it('flags a radio heard at one spot only', () => {
    const [r] = anchorRadios([reading('s#1', `${R}:01`, 'SRMIST', -60, 'TP706')], spots);
    expect(r.basis).toBe('single-spot');
  });

  it('uses the strongest of several scans at one spot', () => {
    const rs = [
      reading('s#1', `${R}:01`, 'SRMIST', -90, 'Room 703'),
      reading('s#2', `${R}:01`, 'SRMIST', -52, 'Room 703'),
      reading('s#3', `${R}:01`, 'SRMIST', -60, 'Room 702'),
    ];
    expect(anchorRadios(rs, spots)[0].spot).toBe('Room 703'); // -52 vs -60: not -90 vs -60
  });

  it('a hand override beats the measurements', () => {
    const rs = [reading('s#1', `${R}:01`, 'SRMIST', -50, 'Room 703')];
    expect(anchorRadios(rs, spots, { overrides: { [R]: { spot: 'TP706' } } })[0]).toMatchObject({ x: -20, y: -5, basis: 'override' });
    expect(anchorRadios(rs, spots, { overrides: { [R]: { x: 1.5, y: -2 } } })[0]).toMatchObject({ x: 1.5, y: -2, basis: 'override' });
  });

  it('can leave one scan out, which is what the leave-one-scan-out check relies on', () => {
    const rs = [reading('s#1', `${R}:01`, 'SRMIST', -40, 'Room 703'), reading('s#2', `${R}:01`, 'SRMIST', -70, 'Room 702')];
    expect(anchorRadios(rs, spots)[0].spot).toBe('Room 703');
    expect(anchorRadios(rs, spots, { excludeScan: 's#1' })[0].spot).toBe('Room 702');
    expect(anchorRadios(rs, spots, { excludeScan: 's#1' }).length).toBe(1);
  });

  it('a radio heard only in the left-out scan is not placed at all', () => {
    const rs = [reading('s#1', `${R}:01`, 'SRMIST', -40, 'Room 703')];
    expect(anchorRadios(rs, spots, { excludeScan: 's#1' })).toEqual([]);
  });

  it('refuses a spot the map does not know, rather than dropping its readings', () => {
    expect(() => anchorRadios([reading('s#1', `${R}:01`, 'SRMIST', -40, 'Room 999')], spots)).toThrow(/Unknown spot "Room 999"/);
  });
});
