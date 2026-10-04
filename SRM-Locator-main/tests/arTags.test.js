import { describe, it, expect } from 'vitest';
import {
  projectScreenX,
  projectScreenY,
  followArTarget,
  arTargetForMember,
  ASSUMED_CAMERA_FOV_DEG,
  MAX_TAG_DISTANCE_METERS,
  TAG_BAND_TOP,
  TAG_BAND_BOTTOM,
} from '../src/utils/arTags.js';

// A pinhole camera's x on a 1000-wide screen for `diff` degrees off centre.
const pinholeX = (diff, fov = 60) => 500 + (Math.tan((diff * Math.PI) / 180) / Math.tan((fov / 2) * Math.PI / 180)) * 500;

describe('projectScreenX', () => {
  it('maps straight ahead to the centre and half the FOV to the edges, by the tangent', () => {
    expect(projectScreenX(0, 1000, 60)).toBe(500);
    expect(projectScreenX(15, 1000, 60)).toBeCloseTo(732.05, 2); // a pinhole lens, not 750
    expect(projectScreenX(-15, 1000, 60)).toBeCloseTo(267.95, 2);
    expect(projectScreenX(29.9, 1000, 60)).toBeCloseTo(997.99, 1);
  });

  it('excludes a target exactly on the edge of the view, or beyond it', () => {
    expect(projectScreenX(30, 1000, 60)).toBeNull();
    expect(projectScreenX(-30, 1000, 60)).toBeNull();
    expect(projectScreenX(90, 1000, 60)).toBeNull();
  });

  it('never places a target behind the user', () => {
    for (const d of [180, -180, 179.9, -179.9]) expect(projectScreenX(d, 1000)).toBeNull();
    expect(projectScreenX(NaN, 1000)).toBeNull();
  });

  it('defaults to ASSUMED_CAMERA_FOV_DEG', () => {
    expect(projectScreenX(ASSUMED_CAMERA_FOV_DEG / 4, 1000)).toBeCloseTo(pinholeX(ASSUMED_CAMERA_FOV_DEG / 4, ASSUMED_CAMERA_FOV_DEG), 6);
  });
});

describe('projectScreenY', () => {
  it('puts nearer things lower, within the band', () => {
    expect(projectScreenY(0, 100)).toBeCloseTo(TAG_BAND_BOTTOM * 100);
    expect(projectScreenY(MAX_TAG_DISTANCE_METERS, 100)).toBeCloseTo(TAG_BAND_TOP * 100);
    expect(projectScreenY(5000, 100)).toBeCloseTo(TAG_BAND_TOP * 100);
    expect(projectScreenY(100, 100)).toBeGreaterThan(projectScreenY(300, 100));
  });
});

describe('arTargetForMember / followArTarget', () => {
  const bravo = { id: 'sock-1', uid: 'u-b', name: 'BRAVO', hasFix: true, lat: 1, lng: 2 };

  it('remembers the member by uid, or by socket id when they have none', () => {
    expect(arTargetForMember(bravo)).toEqual({ lat: 1, lng: 2, name: 'BRAVO', memberUid: 'u-b' });
    expect(arTargetForMember({ ...bravo, uid: null, name: '' })).toEqual({ lat: 1, lng: 2, name: 'SQUAD_NODE', memberId: 'sock-1' });
  });

  it('moves to the member’s live position, matched by uid across a socket id change', () => {
    const t = arTargetForMember(bravo);
    expect(followArTarget(t, [{ ...bravo, id: 'sock-2', lat: 5, lng: 6 }])).toEqual({ ...t, lat: 5, lng: 6 });
  });

  it('matches by socket id when there is no uid', () => {
    const t = arTargetForMember({ ...bravo, uid: null });
    expect(followArTarget(t, [{ ...bravo, uid: null, lat: 5, lng: 6 }])).toMatchObject({ lat: 5, lng: 6 });
  });

  it('returns the same object when there is nothing newer', () => {
    const t = arTargetForMember(bravo);
    expect(followArTarget(t, [bravo])).toBe(t); // hasn't moved
    expect(followArTarget(t, [{ ...bravo, hasFix: false, lat: null, lng: null }])).toBe(t); // lost fix
    expect(followArTarget(t, [])).toBe(t); // left
    expect(followArTarget(t, [{ ...bravo, uid: 'u-other', lat: 9, lng: 9 }])).toBe(t); // someone else
    const building = { lat: 1, lng: 2, name: 'TECH PARK' };
    expect(followArTarget(building, [{ ...bravo, lat: 9 }])).toBe(building);
    expect(followArTarget(null, [bravo])).toBeNull();
  });
});
