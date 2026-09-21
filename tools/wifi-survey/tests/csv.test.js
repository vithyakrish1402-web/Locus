import { describe, expect, it } from 'vitest';
import { CSV_HEADER, buildPointRows, csvField } from '../src/csv.js';

const fix = { lat: 12.82312345678, lng: 80.04441234567, accuracy: 4.26 };
const ap = (overrides = {}) => ({ bssid: 'a4:2b:b0:11:22:01', ssid: 'SRMIST', rssi: -51, frequencyMhz: 2437, ...overrides });

describe('CSV_HEADER', () => {
  it('matches the Stage 3 column contract exactly', () => {
    expect(CSV_HEADER).toBe(
      'point_id,timestamp,lat,lng,accuracy_m,bssid,ssid,rssi,frequency_mhz,building,floor,spot',
    );
  });
});

describe('csvField', () => {
  it('leaves plain values alone', () => {
    expect(csvField('SRMIST')).toBe('SRMIST');
    expect(csvField(-51)).toBe('-51');
  });

  it('writes empty for null/undefined and keeps empty SSIDs empty', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField('')).toBe('');
  });

  it('quotes and doubles quotes for SSIDs with commas, quotes or newlines', () => {
    expect(csvField('Cafe "Java", Block B')).toBe('"Cafe ""Java"", Block B"');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('a\r\nb')).toBe('"a\r\nb"');
  });

  it('quotes leading/trailing whitespace so parsers that trim cannot alter the SSID', () => {
    expect(csvField(' lab ')).toBe('" lab "');
  });
});

describe('buildPointRows', () => {
  it('emits one row per access point, sharing the point columns', () => {
    const rows = buildPointRows({
      pointId: 3,
      timestamp: '2026-09-21T10:00:00.000Z',
      fix,
      aps: [ap(), ap({ bssid: 'a4:2b:b0:11:22:02', ssid: '', rssi: -70, frequencyMhz: 5180 })],
    });
    expect(rows).toEqual([
      '3,2026-09-21T10:00:00.000Z,12.8231235,80.0444123,4.3,a4:2b:b0:11:22:01,SRMIST,-51,2437,,,',
      '3,2026-09-21T10:00:00.000Z,12.8231235,80.0444123,4.3,a4:2b:b0:11:22:02,,-70,5180,,,',
    ]);
  });

  it('escapes hostile SSIDs inside a row', () => {
    const [row] = buildPointRows({ pointId: 1, timestamp: 't', fix, aps: [ap({ ssid: 'x,"y"' })] });
    expect(row.endsWith(',"x,""y""",-51,2437,,,')).toBe(true);
  });

  it('appends the location tag to every row of the point', () => {
    const rows = buildPointRows({
      pointId: 7,
      timestamp: 't',
      fix,
      aps: [ap(), ap({ bssid: 'a4:2b:b0:11:22:02' })],
      tag: { building: 'TECH PARK', floor: 4, spot: '  corridor, near lift ' },
    });
    for (const row of rows) expect(row.endsWith(',TECH PARK,4,"corridor, near lift"')).toBe(true);
  });

  it('writes ground and basement floors as numbers, and an unset floor as empty', () => {
    const row = (floor) =>
      buildPointRows({ pointId: 1, timestamp: 't', fix, aps: [ap()], tag: { building: 'OTHER', floor } })[0];
    expect(row(0).endsWith(',OTHER,0,')).toBe(true);
    expect(row(-1).endsWith(',OTHER,-1,')).toBe(true);
    expect(row(null).endsWith(',OTHER,,')).toBe(true);
    expect(() => row(1.5)).toThrow(/floor/);
  });

  it('refuses to build rows that would be malformed', () => {
    const base = { pointId: 1, timestamp: 't', fix, aps: [ap()] };
    expect(() => buildPointRows({ ...base, pointId: 0 })).toThrow(/point_id/);
    expect(() => buildPointRows({ ...base, pointId: 1.5 })).toThrow(/point_id/);
    expect(() => buildPointRows({ ...base, fix: { lat: NaN, lng: 1, accuracy: 1 } })).toThrow(/GPS/);
    expect(() => buildPointRows({ ...base, fix: null })).toThrow(/GPS/);
    expect(() => buildPointRows({ ...base, aps: [] })).toThrow(/No access points/);
    expect(() => buildPointRows({ ...base, aps: [ap({ bssid: '' })] })).toThrow(/Malformed/);
    expect(() => buildPointRows({ ...base, aps: [ap({ rssi: undefined })] })).toThrow(/Malformed/);
  });
});
