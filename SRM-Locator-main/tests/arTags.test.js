import { describe, it, expect } from 'vitest';
import {
  projectScreenX,
  projectScreenY,
  selectArTags,
  followArTarget,
  arTargetForMember,
  ASSUMED_CAMERA_FOV_DEG,
  MAX_TAG_DISTANCE_METERS,
  MAX_VISIBLE_TAGS,
  TAG_BAND_TOP,
  TAG_BAND_BOTTOM,
} from '../src/utils/arTags.js';
import { calculateBearing, calculateDistanceMeters } from '../src/utils/geoMath.js';

const ORIGIN = { lat: 12.8230, lng: 80.0440 };

// A point `meters` away from ORIGIN along `bearing` (flat-earth; fine over a few hundred m).
const at = (bearing, meters) => {
  const r = (bearing * Math.PI) / 180;
  return {
    lat: ORIGIN.lat + (meters * Math.cos(r)) / 111320,
    lng: ORIGIN.lng + (meters * Math.sin(r)) / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
  };
};
const building = (id, bearing, meters) => ({ id, name: `B${id}`, ...at(bearing, meters) });
const member = (id, bearing, meters, extra = {}) => ({ id, uid: `u-${id}`, name: `M${id}`, hasFix: true, ...at(bearing, meters), ...extra });
const tags = (opts) => selectArTags({ origin: ORIGIN, heading: 0, screenWidth: 1000, screenHeight: 800, ...opts });

describe('projectScreenX', () => {
  it('maps straight ahead to the centre and half the FOV to the edges', () => {
    expect(projectScreenX(0, 1000, 60)).toBe(500);
    expect(projectScreenX(15, 1000, 60)).toBe(750);
    expect(projectScreenX(-15, 1000, 60)).toBe(250);
    expect(projectScreenX(29.9, 1000, 60)).toBeCloseTo(998.33, 1);
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
    expect(projectScreenX(ASSUMED_CAMERA_FOV_DEG / 4, 1000)).toBe(750);
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

describe('selectArTags', () => {
  it('places a tag from bearing, heading and distance', () => {
    const b = building(1, 105, 200); // 15 deg right of a 90 deg heading
    const { ambient } = tags({ heading: 90, buildings: [b] });
    expect(ambient).toHaveLength(1);
    const expectedDiff = calculateBearing(ORIGIN.lat, ORIGIN.lng, b.lat, b.lng) - 90;
    expect(ambient[0].x).toBeCloseTo(500 + (expectedDiff / 30) * 500, 6);
    expect(ambient[0].x).toBeCloseTo(750, -1);
    expect(ambient[0].distance).toBe(calculateDistanceMeters(ORIGIN.lat, ORIGIN.lng, b.lat, b.lng));
    expect(ambient[0]).toMatchObject({ key: 'building-1', kind: 'building', name: 'B1' });
  });

  it('works across north', () => {
    const { ambient } = tags({ heading: 350, buildings: [building(1, 5, 100)] });
    expect(ambient).toHaveLength(1);
    expect(ambient[0].x).toBeCloseTo(500 + (15 / 30) * 500, -1);
  });

  it('drops anything outside the view cone, including straight behind', () => {
    const { ambient } = tags({ buildings: [building(1, 45, 100), building(2, 180, 100), building(3, -40, 100)] });
    expect(ambient).toEqual([]);
  });

  it('drops a target beyond MAX_TAG_DISTANCE_METERS even when dead ahead', () => {
    const { ambient } = tags({ buildings: [building(1, 0, MAX_TAG_DISTANCE_METERS + 20), building(2, 0, MAX_TAG_DISTANCE_METERS - 20)] });
    expect(ambient.map((t) => t.name)).toEqual(['B2']);
  });

  it('keeps only the nearest MAX_VISIBLE_TAGS', () => {
    const many = Array.from({ length: MAX_VISIBLE_TAGS + 3 }, (_, i) => building(i, (i % 5) - 2, 400 - i * 30));
    const { ambient } = tags({ buildings: many });
    expect(ambient).toHaveLength(MAX_VISIBLE_TAGS);
    const kept = ambient.map((t) => t.distance);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    const allDistances = many.map((b) => calculateDistanceMeters(ORIGIN.lat, ORIGIN.lng, b.lat, b.lng)).sort((a, b) => a - b);
    expect(kept).toEqual(allDistances.slice(0, MAX_VISIBLE_TAGS));
  });

  it('tags squad members with a fix, never ones without, and never yourself', () => {
    const { ambient } = tags({
      selfUid: 'u-me',
      members: [
        member('a', 5, 50),
        member('b', 0, 60, { hasFix: false }),
        member('me', -5, 70, { uid: 'u-me' }),
        member('c', 0, 80, { hasFix: true, lat: null, lng: null }),
      ],
    });
    expect(ambient.map((t) => t.key)).toEqual(['member-a']);
    expect(ambient[0].kind).toBe('member');
  });

  it('shows the destination as its own tag, outside the cap and distance limit', () => {
    const far = { name: 'SRM_HQ', ...at(2, 1500) };
    const crowd = Array.from({ length: MAX_VISIBLE_TAGS + 2 }, (_, i) => building(i, 0, 100 + i * 10));
    const { target, ambient } = tags({ target: far, buildings: crowd });
    expect(target).toMatchObject({ kind: 'target', name: 'SRM_HQ' });
    expect(ambient).toHaveLength(MAX_VISIBLE_TAGS);
  });

  it('does not tag the destination twice', () => {
    const m = member('a', 0, 100);
    const { target, ambient } = tags({ members: [m], target: { name: m.name, lat: m.lat, lng: m.lng } });
    expect(target.name).toBe('Ma');
    expect(ambient).toEqual([]);
  });

  it('shows no destination tag when it is out of view', () => {
    expect(tags({ target: { name: 'X', ...at(180, 100) } }).target).toBeNull();
  });

  it('tags nothing without a location or a heading, or when standing on the spot', () => {
    expect(selectArTags({ origin: null, heading: 0, buildings: [building(1, 0, 100)], screenWidth: 100, screenHeight: 100 }))
      .toEqual({ target: null, ambient: [] });
    expect(tags({ heading: NaN, buildings: [building(1, 0, 100)] }).ambient).toEqual([]);
    expect(tags({ buildings: [{ id: 9, name: 'HERE', ...ORIGIN }] }).ambient).toEqual([]);
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

describe('selectArTags, destination on a squad member', () => {
  it('gives that member no ambient tag, even when the destination is a stale spot', () => {
    const m = member('a', 0, 100);
    const staleTarget = { ...arTargetForMember(m), ...at(3, 60) };
    const { target, ambient } = tags({ members: [m, member('b', 5, 150)], target: staleTarget });
    expect(target.name).toBe('Ma');
    expect(ambient.map((t) => t.key)).toEqual(['member-b']);
  });
});
