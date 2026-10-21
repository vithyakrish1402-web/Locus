// Pure geometry and navigation math for turn-by-turn tracking, cross-track error,
// and smooth camera navigation.

import { toRad, toDeg, calculateBearing, angularDifference } from './geoMath';

const EARTH_RADIUS_M = 6371e3;

/**
 * Calculates distance in meters between two lat/lng coordinates (Haversine).
 */
export function haversineMeters(p1, p2) {
  if (!p1 || !p2) return 0;
  const phi1 = toRad(p1.lat);
  const phi2 = toRad(p2.lat);
  const deltaPhi = toRad(p2.lat - p1.lat);
  const deltaLambda = toRad(p2.lng - p1.lng);

  const a = Math.sin(deltaPhi / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Project point P onto great-circle segment AB in flat approximation (equirectangular projection),
 * which is accurate for localized campus scale (within a few kilometers).
 * Returns { distance: meters, fraction: 0..1, point: {lat, lng} }
 */
export function projectPointOnSegment(p, a, b) {
  const avgLat = toRad((a.lat + b.lat) / 2);
  const cosLat = Math.cos(avgLat);

  // Convert to local Cartesian coordinates in meters from origin A
  const xB = toRad(b.lng - a.lng) * EARTH_RADIUS_M * cosLat;
  const yB = toRad(b.lat - a.lat) * EARTH_RADIUS_M;

  const xP = toRad(p.lng - a.lng) * EARTH_RADIUS_M * cosLat;
  const yP = toRad(p.lat - a.lat) * EARTH_RADIUS_M;

  const segLengthSq = xB * xB + yB * yB;
  if (segLengthSq === 0) {
    const dist = Math.hypot(xP, yP);
    return { distance: dist, fraction: 0, point: { lat: a.lat, lng: a.lng } };
  }

  // Projection scalar t
  let t = (xP * xB + yP * yB) / segLengthSq;
  t = Math.max(0, Math.min(1, t));

  const projX = t * xB;
  const projY = t * yB;

  const dist = Math.hypot(xP - projX, yP - projY);

  const projLat = a.lat + toDeg(projY / EARTH_RADIUS_M);
  const projLng = a.lng + toDeg(projX / (EARTH_RADIUS_M * cosLat));

  return {
    distance: dist,
    fraction: t,
    point: { lat: projLat, lng: projLng },
  };
}

/**
 * Finds the closest point on a polyline path to point P, and remaining distance along path.
 * Returns:
 * {
 *   nearestSegmentIndex: number,
 *   nearestPoint: {lat, lng},
 *   crossTrackDistance: meters,
 *   remainingDistanceMeters: meters
 * }
 */
export function findNearestPointOnPath(point, path) {
  if (!point || !Array.isArray(path) || path.length === 0) {
    return {
      nearestSegmentIndex: -1,
      nearestPoint: null,
      crossTrackDistance: Infinity,
      remainingDistanceMeters: 0,
    };
  }

  if (path.length === 1) {
    const d = haversineMeters(point, path[0]);
    return {
      nearestSegmentIndex: 0,
      nearestPoint: path[0],
      crossTrackDistance: d,
      remainingDistanceMeters: d,
    };
  }

  let minDistance = Infinity;
  let bestSegIndex = 0;
  let bestPoint = path[0];
  let bestFraction = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const segA = path[i];
    const segB = path[i + 1];
    const proj = projectPointOnSegment(point, segA, segB);
    if (proj.distance < minDistance) {
      minDistance = proj.distance;
      bestSegIndex = i;
      bestPoint = proj.point;
      bestFraction = proj.fraction;
    }
  }

  // Calculate remaining distance along the path from bestPoint to the end
  let remaining = 0;
  // distance from bestPoint to end of current segment
  remaining += haversineMeters(bestPoint, path[bestSegIndex + 1]);
  // plus all following segments
  for (let j = bestSegIndex + 1; j < path.length - 1; j++) {
    remaining += haversineMeters(path[j], path[j + 1]);
  }

  return {
    nearestSegmentIndex: bestSegIndex,
    nearestPoint: bestPoint,
    fraction: bestFraction,
    crossTrackDistance: minDistance,
    remainingDistanceMeters: remaining,
  };
}

/**
 * Normalizes maneuver type to standard visual direction:
 * 'straight', 'turn-slight-right', 'turn-right', 'turn-sharp-right',
 * 'uturn-right', 'turn-slight-left', 'turn-left', 'turn-sharp-left',
 * 'uturn-left', 'arrive', 'depart'
 */
export function normalizeManeuverModifier(modifier, type = '') {
  const m = String(modifier || '').toLowerCase().replace(/_/g, '-');
  const t = String(type || '').toLowerCase();

  if (t === 'arrive' || t.includes('destination')) return 'arrive';
  if (t === 'depart') return 'depart';

  if (m.includes('sharp-right') || m === 'sharp right') return 'turn-sharp-right';
  if (m.includes('slight-right') || m === 'slight right') return 'turn-slight-right';
  if (m.includes('right')) return 'turn-right';
  if (m.includes('sharp-left') || m === 'sharp left') return 'turn-sharp-left';
  if (m.includes('slight-left') || m === 'slight left') return 'turn-slight-left';
  if (m.includes('left')) return 'turn-left';
  if (m.includes('u-turn') || m.includes('uturn')) return 'uturn';
  if (m.includes('straight') || t === 'continue') return 'straight';

  return 'straight';
}

/**
 * Calculates synthetic turn-by-turn steps from a polyline path if routing service
 * did not provide step-by-step maneuvers (or if using straight-line/synthesized route).
 */
export function generateStepsFromPath(path, destinationName = 'Destination') {
  if (!Array.isArray(path) || path.length < 2) {
    return [
      {
        id: 'step-0',
        instruction: `Head to ${destinationName}`,
        maneuver: 'straight',
        distanceMeters: 0,
        startLocation: path?.[0] || { lat: 0, lng: 0 },
        endLocation: path?.[0] || { lat: 0, lng: 0 },
      },
    ];
  }

  const steps = [];
  let currentStep = {
    id: 'step-0',
    instruction: 'Start walking',
    maneuver: 'depart',
    distanceMeters: 0,
    startLocation: path[0],
    endLocation: path[1],
  };

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];
    const segDist = haversineMeters(p1, p2);
    currentStep.distanceMeters += segDist;
    currentStep.endLocation = p2;

    if (i < path.length - 2) {
      const p3 = path[i + 2];
      const b1 = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);
      const b2 = calculateBearing(p2.lat, p2.lng, p3.lat, p3.lng);
      const turnAngle = angularDifference(b2, b1);

      // If noticeable turn (> 25 degrees)
      if (Math.abs(turnAngle) > 25) {
        steps.push(currentStep);

        let maneuver = 'straight';
        let turnWord = 'Continue';
        if (turnAngle > 120) {
          maneuver = 'uturn-right';
          turnWord = 'Make a U-turn';
        } else if (turnAngle > 60) {
          maneuver = 'turn-right';
          turnWord = 'Turn right';
        } else if (turnAngle > 25) {
          maneuver = 'turn-slight-right';
          turnWord = 'Turn slight right';
        } else if (turnAngle < -120) {
          maneuver = 'uturn-left';
          turnWord = 'Make a U-turn';
        } else if (turnAngle < -60) {
          maneuver = 'turn-left';
          turnWord = 'Turn left';
        } else if (turnAngle < -25) {
          maneuver = 'turn-slight-left';
          turnWord = 'Turn slight left';
        }

        currentStep = {
          id: `step-${steps.length}`,
          instruction: turnWord,
          maneuver,
          distanceMeters: 0,
          startLocation: p2,
          endLocation: p3,
        };
      }
    }
  }

  // Final step
  steps.push(currentStep);

  // Add explicit arrival step
  const lastPoint = path[path.length - 1];
  steps.push({
    id: `step-${steps.length}`,
    instruction: `Arrive at ${destinationName}`,
    maneuver: 'arrive',
    distanceMeters: 0,
    startLocation: lastPoint,
    endLocation: lastPoint,
  });

  return steps;
}

/**
 * Circular angle interpolation for camera bearings avoiding 0/360 spin.
 * Interpolates from angle `from` to `to` by weight `t` (0..1).
 */
export function interpolateHeading(from, to, t) {
  const diff = angularDifference(to, from);
  const result = from + diff * t;
  return (result % 360 + 360) % 360;
}
