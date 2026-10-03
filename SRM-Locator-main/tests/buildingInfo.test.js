import { describe, it, expect } from 'vitest';
import { BUILDING_DETAILS, buildingDetails } from '../src/utils/buildingInfo.js';
import { SRM_MASTER_DATABASE } from '../src/srmDatabase.js';
import { HERE_METRES, locateTarget } from '../src/utils/direction.js';

describe('buildingDetails', () => {
  it('has no details for a building with no entry, and never undefined fields', () => {
    const d = buildingDetails({ id: 99999, name: 'X' });
    expect(d).toEqual({ description: null, departments: [], facilities: [], floors: null, hasDetails: false });
  });

  it('drops blank, non-string and non-positive values instead of showing them', () => {
    const table = { 1: { description: '  ', departments: ['CSE', '', null, 3], floors: 0, facilities: 'no' } };
    const d = buildingDetails({ id: 1 }, table);
    expect(d.description).toBeNull();
    expect(d.departments).toEqual(['CSE']);
    expect(d.floors).toBeNull();
    expect(d.facilities).toEqual([]);
    expect(d.hasDetails).toBe(true);
  });

  it('copes with a missing building', () => {
    expect(buildingDetails(null).hasDetails).toBe(false);
  });

  it('only describes buildings that exist', () => {
    const ids = new Set(SRM_MASTER_DATABASE.map((b) => b.id));
    for (const id of Object.keys(BUILDING_DETAILS)) expect(ids.has(Number(id)), id).toBe(true);
  });
});

describe('locateTarget', () => {
  const me = { lat: 12.8234, lng: 80.0424 };

  it('is null until both points have coordinates', () => {
    expect(locateTarget(null, me)).toBeNull();
    expect(locateTarget(me, { lat: undefined, lng: 80 })).toBeNull();
  });

  it('says WITH YOU under the HERE threshold', () => {
    expect(HERE_METRES).toBe(15);
    expect(locateTarget(me, me).here).toBe(true);
    expect(locateTarget(me, me).direction).toBe('WITH YOU');
  });

  it('gives a compass point without a compass, and a clock face with one', () => {
    const north = { lat: me.lat + 0.001, lng: me.lng };
    expect(locateTarget(me, north).direction).toBe('BEARING N');
    expect(locateTarget(me, north, { heading: 0, headingLive: true }).direction).toBe('AHEAD');
    expect(locateTarget(me, north, { heading: 180, headingLive: true }).direction).toBe('BEHIND');
  });
});
