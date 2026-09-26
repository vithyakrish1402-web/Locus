import { describe, it, expect } from 'vitest';
import {
  toRad,
  toDeg,
  calculateDistanceMeters,
  formatTacticalDistance,
  formatTacticalDistanceBracketed,
  calculateBearing,
  normalizeRotationDelta,
  angularDifference,
  projectGhostLocation
} from '../src/utils/geoMath';

describe('geoMath Utility', () => {
  describe('Angle conversions', () => {
    it('correctly converts degrees to radians and back', () => {
      expect(toRad(180)).toBeCloseTo(Math.PI);
      expect(toRad(90)).toBeCloseTo(Math.PI / 2);
      expect(toDeg(Math.PI)).toBeCloseTo(180);
      expect(toDeg(Math.PI / 2)).toBeCloseTo(90);
    });
  });

  describe('calculateDistanceMeters', () => {
    it('returns 0 when coordinates are identical', () => {
      const lat = 12.8237;
      const lng = 80.0444;
      expect(calculateDistanceMeters(lat, lng, lat, lng)).toBe(0);
    });

    it('returns 0 when coordinates are missing or nullish', () => {
      expect(calculateDistanceMeters(null, 80.0444, 12.8237, 80.0444)).toBe(0);
      expect(calculateDistanceMeters(12.8237, undefined, 12.8237, 80.0444)).toBe(0);
    });

    it('accurately computes distance between known coordinates', () => {
      // SRM Tech Park: 12.8248, 80.0452 to SRM Main Campus Arch: 12.8231, 80.0416 (~430-450m)
      const distance = calculateDistanceMeters(12.8248, 80.0452, 12.8231, 80.0416);
      expect(distance).toBeGreaterThan(400);
      expect(distance).toBeLessThan(500);
    });
  });

  describe('formatTacticalDistance', () => {
    it('returns formatted meters when distance is <= 1000m', () => {
      // Small shift (~110m)
      const formatted = formatTacticalDistance(12.8237, 80.0444, 12.8247, 80.0444);
      expect(formatted).toMatch(/^\d+\sM$/);
    });

    it('returns formatted kilometers when distance is > 1000m', () => {
      // ~11 km shift
      const formatted = formatTacticalDistance(12.8237, 80.0444, 12.9237, 80.0444);
      expect(formatted).toMatch(/^\d+\.\d\sKM$/);
    });

    it('returns fallback string if coordinates are missing', () => {
      expect(formatTacticalDistance(null, null, 12.8237, 80.0444)).toBe('0 M');
    });
  });

  describe('formatTacticalDistanceBracketed', () => {
    it('returns [ SIGNAL_LOST ] if coordinates are missing', () => {
      expect(formatTacticalDistanceBracketed(null, null, 12.8237, 80.0444)).toBe('[ SIGNAL_LOST ]');
    });

    it('formats short distance with brackets', () => {
      const res = formatTacticalDistanceBracketed(12.8237, 80.0444, 12.8240, 80.0444);
      expect(res).toMatch(/^\[\s\d+\sM\s\]$/);
    });

    it('formats long distance with brackets in KM', () => {
      const res = formatTacticalDistanceBracketed(12.8237, 80.0444, 12.9237, 80.0444);
      expect(res).toMatch(/^\[\s\d+\.\d{2}\sKM\s\]$/);
    });
  });

  describe('calculateBearing', () => {
    it('returns ~0° for due North', () => {
      const bearing = calculateBearing(0, 0, 1, 0);
      expect(bearing).toBeCloseTo(0, 1);
    });

    it('returns ~90° for due East', () => {
      const bearing = calculateBearing(0, 0, 0, 1);
      expect(bearing).toBeCloseTo(90, 1);
    });

    it('returns ~180° for due South', () => {
      const bearing = calculateBearing(1, 0, 0, 0);
      expect(bearing).toBeCloseTo(180, 1);
    });

    it('returns ~270° for due West', () => {
      const bearing = calculateBearing(0, 1, 0, 0);
      expect(bearing).toBeCloseTo(270, 1);
    });

    it('returns 0 for invalid inputs', () => {
      expect(calculateBearing(null, undefined, 1, 1)).toBe(0);
    });
  });

  describe('normalizeRotationDelta', () => {
    it('calculates standard positive angle delta', () => {
      expect(normalizeRotationDelta(50, 30)).toBe(20);
    });

    it('calculates standard negative angle delta', () => {
      expect(normalizeRotationDelta(30, 50)).toBe(-20);
    });

    it('handles North 0°/360° wraparound clockwise without a 340° spin', () => {
      // target is 10° (just past north), current is 350° (just before north)
      // shortest delta is +20°, not -340°
      expect(normalizeRotationDelta(10, 350)).toBe(20);
    });

    it('handles North 0°/360° wraparound counter-clockwise without a 340° spin', () => {
      // target is 350°, current is 10° -> shortest delta is -20°, not +340°
      expect(normalizeRotationDelta(350, 10)).toBe(-20);
    });

    it('never exceeds [-180, 180]', () => {
      const delta1 = normalizeRotationDelta(180, 0);
      expect(Math.abs(delta1)).toBeLessThanOrEqual(180);
    });
  });

  describe('projectGhostLocation (Dead Reckoning)', () => {
    const startLat = 12.8237;
    const startLng = 80.0444;

    it('returns identical coordinates if speed is 0 or stationary (< 1 km/h)', () => {
      const projected = projectGhostLocation(startLat, startLng, 0, 90, 10);
      expect(projected.lat).toBe(startLat);
      expect(projected.lng).toBe(startLng);
    });

    it('returns identical coordinates if timeDelta is 0', () => {
      const projected = projectGhostLocation(startLat, startLng, 30, 90, 0);
      expect(projected.lat).toBe(startLat);
      expect(projected.lng).toBe(startLng);
    });

    it('projects northward movement when heading is 0°', () => {
      // 36 km/h = 10 m/s. Over 10 seconds -> 100 meters north
      const projected = projectGhostLocation(startLat, startLng, 36, 0, 10);
      expect(projected.lat).toBeGreaterThan(startLat);
      expect(projected.lng).toBeCloseTo(startLng, 5);

      const distanceTravelled = calculateDistanceMeters(startLat, startLng, projected.lat, projected.lng);
      expect(distanceTravelled).toBeCloseTo(100, -1);
    });

    it('projects eastward movement when heading is 90°', () => {
      // 36 km/h = 10 m/s. Over 10 seconds -> 100 meters east
      const projected = projectGhostLocation(startLat, startLng, 36, 90, 10);
      expect(projected.lng).toBeGreaterThan(startLng);
      expect(projected.lat).toBeCloseTo(startLat, 5);

      const distanceTravelled = calculateDistanceMeters(startLat, startLng, projected.lat, projected.lng);
      expect(distanceTravelled).toBeCloseTo(100, -1);
    });
  });
});

describe('angularDifference', () => {
  it('is the shortest signed turn from one bearing to another, across north', () => {
    expect(angularDifference(105, 90)).toBe(15);
    expect(angularDifference(10, 350)).toBe(20);
    expect(angularDifference(350, 10)).toBe(-20);
    expect(angularDifference(-10, 710)).toBe(0);
  });

  it('is exactly what normalizeRotationDelta computes', () => {
    for (let a = -400; a <= 400; a += 37) {
      for (let b = -400; b <= 400; b += 41) {
        expect(angularDifference(a, b)).toBe(normalizeRotationDelta(a, b));
      }
    }
  });
});
