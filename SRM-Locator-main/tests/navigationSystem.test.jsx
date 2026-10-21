import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  projectPointOnSegment,
  findNearestPointOnPath,
  normalizeManeuverModifier,
  generateStepsFromPath,
  interpolateHeading,
} from '../src/utils/navGeometry';
import { findCampusPedestrianRoute, CAMPUS_PEDESTRIAN_NODES } from '../src/data/campusPedestrianGraph';

describe('Navigation Geometry & Maneuvers', () => {
  it('calculates haversine distance correctly', () => {
    const p1 = { lat: 12.8234851, lng: 80.042357 };
    const p2 = { lat: 12.8246325, lng: 80.0453585 };
    const dist = haversineMeters(p1, p2);
    expect(dist).toBeGreaterThan(300);
    expect(dist).toBeLessThan(400);
  });

  it('projects a point onto a line segment accurately', () => {
    const a = { lat: 12.820, lng: 80.040 };
    const b = { lat: 12.820, lng: 80.050 };
    const p = { lat: 12.821, lng: 80.045 }; // 100m north of midpoint

    const projection = projectPointOnSegment(p, a, b);
    expect(projection.fraction).toBeCloseTo(0.5, 1);
    expect(projection.distance).toBeGreaterThan(50);
    expect(projection.point.lat).toBeCloseTo(12.820, 3);
    expect(projection.point.lng).toBeCloseTo(80.045, 3);
  });

  it('detects off-route cross-track distance accurately', () => {
    const path = [
      { lat: 12.8234851, lng: 80.042357 },
      { lat: 12.8236146, lng: 80.0424808 },
      { lat: 12.8236272, lng: 80.0435541 },
    ];
    // A point right near the middle of segment 1
    const nearPoint = { lat: 12.82362, lng: 80.0430 };
    const result = findNearestPointOnPath(nearPoint, path);
    expect(result.crossTrackDistance).toBeLessThan(10);
    expect(result.remainingDistanceMeters).toBeGreaterThan(0);

    // A point far away
    const farPoint = { lat: 12.8300, lng: 80.0500 };
    const farResult = findNearestPointOnPath(farPoint, path);
    expect(farResult.crossTrackDistance).toBeGreaterThan(500);
  });

  it('normalizes maneuvers to standard directional icons', () => {
    expect(normalizeManeuverModifier('sharp right')).toBe('turn-sharp-right');
    expect(normalizeManeuverModifier('slight-left')).toBe('turn-slight-left');
    expect(normalizeManeuverModifier('', 'arrive')).toBe('arrive');
    expect(normalizeManeuverModifier('straight')).toBe('straight');
  });

  it('generates synthetic steps for polyline path with arrival step', () => {
    const path = [
      { lat: 12.820, lng: 80.040 },
      { lat: 12.820, lng: 80.045 },
      { lat: 12.825, lng: 80.045 }, // 90 degree left turn
    ];
    const steps = generateStepsFromPath(path, 'Tech Park');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[steps.length - 1].maneuver).toBe('arrive');
    expect(steps[steps.length - 1].instruction).toContain('Tech Park');
  });

  it('smoothly interpolates headings across 0/360 wrap-around boundary', () => {
    // 350 deg turning to 10 deg: shortest turn is +20 deg clockwise
    const interpolated = interpolateHeading(350, 10, 0.5);
    expect(Math.round(interpolated)).toBe(0);
  });

  it('finds walkable campus pedestrian route between campus buildings', () => {
    const origin = CAMPUS_PEDESTRIAN_NODES.UB_MAIN;
    const dest = CAMPUS_PEDESTRIAN_NODES.TECH_PARK_AVENUE;
    const route = findCampusPedestrianRoute(origin, dest);
    expect(route).not.toBeNull();
    expect(route.length).toBeGreaterThan(2);
    expect(route[0].lat).toBe(origin.lat);
    expect(route[route.length - 1].lat).toBe(dest.lat);
  });
});
