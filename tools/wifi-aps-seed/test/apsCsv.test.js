import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseApsCsv, parseCsv, summarize } from '../src/apsCsv.js';

const HEADER =
  'bssid,ssid,best_lat,best_lng,best_floor,best_building,best_rssi,best_accuracy_m,frequency_mhz,num_sightings,floors_seen,ambiguous_floor';
const csv = (...rows) => [HEADER, ...rows].join('\n') + '\n';

// Rows lifted from the first real survey export.
const PLAIN = '48:2f:6b:3d:c8:a1,SRMIST,12.8248134,80.0449650,0,TECH PARK,-75,28.4,2437,1,0,False';
const AMBIGUOUS = '54:f0:b1:3d:e6:b1,,12.8249211,80.0451718,0,TECH PARK,-80,22.5,5300,2,0|1,True';

describe('parseApsCsv', () => {
  it('maps a row to the wifi_aps document shape', () => {
    const { docs, errors } = parseApsCsv(csv(PLAIN));
    assert.deepEqual(errors, []);
    assert.deepEqual(docs, [
      {
        bssid: '48:2f:6b:3d:c8:a1',
        ssid: 'SRMIST',
        lat: 12.8248134,
        lng: 80.044965,
        floor: 0,
        building: 'TECH PARK',
        rssi: -75,
        accuracyM: 28.4,
        frequencyMhz: 2437,
        numSightings: 1,
        floorsSeen: [0],
        ambiguousFloor: false,
      },
    ]);
  });

  it('carries ambiguous_floor through as ambiguousFloor, with every floor it was seen on', () => {
    const [doc] = parseApsCsv(csv(AMBIGUOUS)).docs;
    assert.equal(doc.ambiguousFloor, true);
    assert.deepEqual(doc.floorsSeen, [0, 1]);
    assert.equal(doc.ssid, ''); // hidden network
  });

  it('refuses an ambiguous_floor it cannot read, instead of defaulting it to false', () => {
    for (const bad of ['', 'yes', 'maybe']) {
      const { errors } = parseApsCsv(csv(PLAIN.replace(/False$/, bad)));
      assert.equal(errors.length, 1, `"${bad}"`);
      assert.match(errors[0], /^Line 2: ambiguous_floor must be True or False/);
    }
    assert.equal(parseApsCsv(csv(PLAIN.replace(/False$/, 'true'))).docs[0].ambiguousFloor, true);
  });

  it('lowercases BSSIDs so they match what the scan plugin reports', () => {
    const [doc] = parseApsCsv(csv(PLAIN.replace('48:2f:6b:3d:c8:a1', '48:2F:6B:3D:C8:A1'))).docs;
    assert.equal(doc.bssid, '48:2f:6b:3d:c8:a1');
  });

  it('rejects a BSSID repeated in the file, since both would write the same document', () => {
    const { errors } = parseApsCsv(csv(PLAIN, PLAIN.replace('SRMIST', 'OTHER')));
    assert.deepEqual(errors, ['Line 3: duplicate bssid 48:2f:6b:3d:c8:a1 (first on line 2)']);
  });

  it('rejects a row whose best floor is not among the floors it was seen on', () => {
    const { errors } = parseApsCsv(csv(PLAIN.replace(',0,False', ',1|2,False')));
    assert.match(errors[0], /best_floor 0 is not in floors_seen \[1, 2\]/);
  });

  it('reports bad values with their line and column', () => {
    const { errors } = parseApsCsv(
      csv(
        PLAIN.replace('48:2f:6b:3d:c8:a1', 'not-a-mac'),
        PLAIN.replace('12.8248134', '').replace('48:2f', '11:2f'),
        PLAIN.replace('-75', '-75.5').replace('48:2f', '22:2f'),
        PLAIN.replace('0,TECH PARK', '0.5,TECH PARK').replace('48:2f', '33:2f'),
        PLAIN.replace(',1,0,False', ',0,0,False').replace('48:2f', '44:2f'),
        'too,few,fields'
      )
    );
    assert.equal(errors.length, 6);
    assert.match(errors[0], /^Line 2: bssid is not a MAC address/);
    assert.match(errors[1], /^Line 3: best_lat must be a number/);
    assert.match(errors[2], /^Line 4: best_rssi must be an integer/);
    assert.match(errors[3], /^Line 5: best_floor must be an integer/);
    assert.match(errors[4], /^Line 6: num_sightings must be between 1/);
    assert.match(errors[5], /^Line 7: expected 12 fields, found 3/);
  });

  it('names missing columns rather than guessing', () => {
    const { errors } = parseApsCsv('bssid,ssid\n48:2f:6b:3d:c8:a1,SRMIST\n');
    assert.match(errors[0], /^Missing column\(s\): best_lat, best_lng, .*ambiguous_floor$/);
  });

  it('matches columns by name, so their order does not matter', () => {
    const cols = HEADER.split(',');
    const vals = PLAIN.split(',');
    const reversed = [cols.reverse().join(','), vals.reverse().join(',')].join('\n');
    assert.deepEqual(parseApsCsv(reversed).docs, parseApsCsv(csv(PLAIN)).docs);
  });

  it('stores an outdoor AP (no building, no floor) as nulls', () => {
    const outdoor = '48:2f:6b:3d:c8:a1,SRMIST,12.82,80.04,,,-70,6.0,2437,3,,False';
    const [doc] = parseApsCsv(csv(outdoor)).docs;
    assert.equal(doc.floor, null);
    assert.equal(doc.building, null);
    assert.deepEqual(doc.floorsSeen, []);
  });

  it('flags an empty file and a header with no rows', () => {
    assert.deepEqual(parseApsCsv('').errors, ['The file is empty']);
    assert.deepEqual(parseApsCsv(HEADER + '\n').errors, ['The file has a header but no rows']);
  });
});

describe('parseCsv', () => {
  it('handles quoted SSIDs with commas, quotes and newlines, CRLF endings and a BOM', () => {
    const text = '﻿a,b\r\n1,"x, ""y""\nz"\r\n2,\r\n';
    assert.deepEqual(parseCsv(text), [
      { line: 1, fields: ['a', 'b'] },
      { line: 2, fields: ['1', 'x, "y"\nz'] },
      { line: 4, fields: ['2', ''] },
    ]);
  });

  it('keeps an SSID containing a comma in one field end to end', () => {
    const [doc] = parseApsCsv(csv(PLAIN.replace('SRMIST', '"Cafe, 2nd floor"'))).docs;
    assert.equal(doc.ssid, 'Cafe, 2nd floor');
  });

  it('rejects an unterminated quote', () => {
    assert.throws(() => parseCsv('a\n"open'), /Line 2: unterminated quoted field/);
  });
});

describe('summarize', () => {
  it('counts documents, ambiguous floors, and APs per floor', () => {
    const { docs } = parseApsCsv(csv(PLAIN, AMBIGUOUS, PLAIN.replace('48:2f', '99:2f').replace(',0,TECH', ',2,TECH').replace(',0,False', ',2,False')));
    assert.deepEqual(summarize(docs), { total: 3, ambiguousFloor: 1, byFloor: { 'floor 0': 2, 'floor 2': 1 } });
  });
});
