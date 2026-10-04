import { describe, it, expect } from 'vitest';
import { buildArLandmarks, AR_LANDMARK_OVERRIDES } from '../src/arLandmarks.js';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase.js';

describe('buildArLandmarks', () => {
  it('makes a landmark of every campus building with a position', () => {
    const list = buildArLandmarks();
    expect(list).toHaveLength(SRM_MASTER_DATABASE.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng)).length);
    for (const l of list) {
      expect(l.id).toMatch(/^building-/);
      expect(l.kind).toBe('building');
      expect(Number.isFinite(l.lat) && Number.isFinite(l.lng)).toBe(true);
    }
    // Every override names a real building, under its real id.
    for (const [id, o] of Object.entries(AR_LANDMARK_OVERRIDES)) {
      expect(SRM_MASTER_DATABASE.find((b) => String(b.id) === id)?.name).toBe(o.name);
    }
  });

  it('takes the height, anchor nudge and footprint, and leaves unknown heights null', () => {
    const db = [
      { id: 1, name: 'A', lat: 1, lng: 2, footprint: [[1, 2], [1.001, 2], [1, 2.001]] },
      { id: 2, name: 'B', lat: 3, lng: 4 },
    ];
    const [a, b] = buildArLandmarks(db, { 1: { name: 'A', heightM: 30, anchorOffsetM: { east: 2, north: -1 } } });
    expect(a).toMatchObject({ id: 'building-1', name: 'A', lat: 1, lng: 2, heightM: 30, anchorOffsetM: { east: 2, north: -1 } });
    expect(a.footprint).toHaveLength(3);
    expect(b).toMatchObject({ id: 'building-2', heightM: null, anchorOffsetM: null, footprint: null });
  });

  it('anchors on the entrance where one is marked', () => {
    const [a] = buildArLandmarks([{ id: 1, name: 'A', lat: 1, lng: 2 }], { 1: { name: 'A', entrance: { lat: 1.0002, lng: 2.0001 } } });
    expect(a).toMatchObject({ lat: 1.0002, lng: 2.0001 });
  });

  it('ignores an override whose name doesn’t match the building under that id', () => {
    const [a] = buildArLandmarks([{ id: 2, name: 'SOMETHING ELSE', lat: 1, lng: 2 }]);
    expect(a.heightM).toBeNull(); // id 2 is TECH PARK's override
    const [b] = buildArLandmarks([{ id: 2, name: 'TECH PARK', lat: 1, lng: 2 }]);
    expect(b.heightM).toBe(AR_LANDMARK_OVERRIDES[2].heightM);
  });

  it('leaves out entries without a position', () => {
    expect(buildArLandmarks([{ id: 1, name: 'A', lat: null, lng: 2 }])).toEqual([]);
  });
});
