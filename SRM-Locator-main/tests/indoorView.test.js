// WiFi Arc Stage 7: the pure pieces - labels, the halo, which squadmates are dimmed, the
// floor list from the survey, and what update-location carries with each flag.
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_HALO_PX,
  MIN_HALO_PX,
  RETURN_CHIP_DELAY_MS,
  buildingAt,
  floorLabel,
  haloFor,
  isOnOtherFloor,
  memberFloorTag,
} from '../src/utils/indoorView.js';
import {
  SHOW_INDOOR_POSITION_TO_SQUAD,
  WIFI_CONFIDENCE_THRESHOLD,
  WIFI_POSITIONING_ENABLED,
  resolvePosition,
  withIndoorFields,
} from '../src/utils/positionSource.js';

vi.mock('../src/firebase.js', () => ({ auth: {}, db: {} }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), getDocsFromServer: vi.fn() }));
const { surveyedFloors } = await import('../src/utils/wifiPositioning.js');

const GPS = { lat: 12.8231, lng: 80.0442 };
const WIFI = { lat: 12.8248, lng: 80.0449 };
const INDOOR = { ...WIFI, building: 'TECH PARK', floor: 2, confidence: 0.8, floors: [0, 1, 2, 7] };

describe('shipped defaults', () => {
  it('ships WiFi on (TECH PARK field test, js-1.1.3), squad sharing off, and the constants as specified', () => {
    expect(WIFI_POSITIONING_ENABLED).toBe(true);
    expect(SHOW_INDOOR_POSITION_TO_SQUAD).toBe(false);
    expect([MIN_HALO_PX, MAX_HALO_PX, RETURN_CHIP_DELAY_MS]).toEqual([24, 60, 2000]);
  });
});

describe('floorLabel', () => {
  it('calls floor 0 G and the rest F{n}', () => {
    expect([0, 1, 2, 7].map(floorLabel)).toEqual(['G', 'F1', 'F2', 'F7']);
  });
});

describe('haloFor', () => {
  it('is widest at the threshold and tightest at full confidence', () => {
    expect(haloFor(WIFI_CONFIDENCE_THRESHOLD).radius).toBe(MAX_HALO_PX);
    expect(haloFor(1).radius).toBe(MIN_HALO_PX);
  });

  it('shrinks and sharpens steadily as confidence rises', () => {
    const steps = [0.6, 0.7, 0.8, 0.9, 1].map((c) => haloFor(c));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].radius).toBeLessThan(steps[i - 1].radius);
      expect(steps[i].solidStop).toBeGreaterThan(steps[i - 1].solidStop);
    }
  });

  it('stays within bounds for anything it is handed', () => {
    for (const c of [-1, 0, 0.3, 1.5, NaN, undefined, null]) {
      const { radius } = haloFor(c);
      expect(radius).toBeGreaterThanOrEqual(MIN_HALO_PX);
      expect(radius).toBeLessThanOrEqual(MAX_HALO_PX);
    }
  });
});

describe('squadmates on the map', () => {
  const view = { building: 'TECH PARK', viewedFloor: 1 };

  it('tags a member with their floor, and only when they reported one', () => {
    expect(memberFloorTag({ name: 'Alex', building: 'TECH PARK', floor: 2 })).toBe('ALEX · F2');
    expect(memberFloorTag({ name: 'Alex', building: 'TECH PARK', floor: 0 })).toBe('ALEX · G');
    expect(memberFloorTag({ name: 'Alex' })).toBeNull();
    expect(memberFloorTag({ name: 'Alex', building: 'TECH PARK', floor: null })).toBeNull();
    expect(memberFloorTag({ name: 'Alex', building: 'TECH PARK', floor: 1.5 })).toBeNull();
  });

  it('dims only members on another floor of the building being viewed', () => {
    expect(isOnOtherFloor({ building: 'TECH PARK', floor: 2 }, view)).toBe(true);
    expect(isOnOtherFloor({ building: 'TECH PARK', floor: 1 }, view)).toBe(false);
    expect(isOnOtherFloor({ building: 'TECH PARK 2', floor: 2 }, view)).toBe(false);
    expect(isOnOtherFloor({}, view)).toBe(false); // outdoors
    expect(isOnOtherFloor({ building: 'TECH PARK', floor: 2 }, null)).toBe(false); // no picker
    expect(isOnOtherFloor({ building: 'TECH PARK', floor: 2 }, { building: 'TECH PARK', viewedFloor: null })).toBe(false); // no tab open
  });
});

describe('surveyedFloors', () => {
  const table = new Map([
    ['a', { building: 'TECH PARK', floor: 7 }],
    ['b', { building: 'TECH PARK', floor: 0 }],
    ['c', { building: 'TECH PARK', floor: 2 }],
    ['d', { building: 'TECH PARK', floor: 0 }],
    ['e', { building: 'OTHER', floor: 3 }],
    ['f', { building: null, floor: null }],
    ['g', { building: 'TECH PARK', floor: null }],
  ]);

  it("lists one building's floors, lowest first, from the table", () => {
    expect(surveyedFloors(table, 'TECH PARK')).toEqual([0, 2, 7]);
    expect(surveyedFloors(table, 'OTHER')).toEqual([3]);
    expect(surveyedFloors(table, 'NOWHERE')).toEqual([]);
    expect(surveyedFloors(null, 'TECH PARK')).toEqual([]);
  });
});

describe('what update-location carries', () => {
  const fusion = (position, indoor) => ({ resolve: () => position, indoor: () => indoor });
  const wifi = { ...WIFI, positionSource: 'wifi' };

  it('resolvePosition alone is Stage 6: exactly its keys, even indoors', () => {
    expect(Object.keys(resolvePosition(GPS, fusion(wifi, INDOOR)))).toEqual(['lat', 'lng', 'positionSource']);
  });

  it('withIndoorFields adds building and floor to a WiFi position indoors', () => {
    expect(withIndoorFields(wifi, fusion(wifi, INDOOR))).toEqual({ ...wifi, building: 'TECH PARK', floor: 2 });
  });

  it('no indoor reading: the keys are left out, not sent as null', () => {
    expect(Object.keys(withIndoorFields(wifi, fusion(wifi, null)))).toEqual(['lat', 'lng', 'positionSource']);
    expect(Object.keys(withIndoorFields(wifi, null))).toEqual(['lat', 'lng', 'positionSource']);
  });

  it('a GPS position gets no floor, however the reading looks', () => {
    const gps = { ...GPS, positionSource: 'gps' };
    expect(withIndoorFields(gps, fusion(gps, INDOOR))).toBe(gps);
  });
});

describe('buildingAt', () => {
  const SQUARE = { name: 'SQUARE', footprint: [[0, 0], [0, 1], [1, 1], [1, 0]] };
  const DOT_ONLY = { name: 'DOT ONLY', lat: 0.5, lng: 0.5 };

  it('finds the building whose footprint holds the point', () => {
    expect(buildingAt({ lat: 0.5, lng: 0.5 }, [DOT_ONLY, SQUARE])?.name).toBe('SQUARE');
    expect(buildingAt({ lat: 1.5, lng: 0.5 }, [SQUARE])).toBeNull();
    expect(buildingAt({ lat: 0.5, lng: -0.1 }, [SQUARE])).toBeNull();
  });

  it('never matches a building with no footprint, or no point at all', () => {
    expect(buildingAt({ lat: 0.5, lng: 0.5 }, [DOT_ONLY])).toBeNull();
    expect(buildingAt(null, [SQUARE])).toBeNull();
    expect(buildingAt({ lat: NaN, lng: 0.5 }, [SQUARE])).toBeNull();
  });

  it('knows the real campus footprints', () => {
    expect(buildingAt({ lat: 12.8246325, lng: 80.0453585 })?.name).toBe('TECH PARK');
    expect(buildingAt({ lat: 12.8247035, lng: 80.0458793 })?.name).toBe('TECH PARK 2');
    expect(buildingAt({ lat: 12.8231, lng: 80.0442 })).toBeNull(); // between buildings
  });
});
