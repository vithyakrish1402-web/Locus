/**
 * Geospatial and navigational mathematics for the LOCUS tactical tracking network.
 */

export const toRad = (deg) => (deg * Math.PI) / 180;
export const toDeg = (rad) => (rad * 180) / Math.PI;

const EARTH_RADIUS_METERS = 6371e3;

/**
 * Calculates raw ground distance between two coordinates in meters via Haversine formula.
 */
export const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
  if (
    lat1 === null || lat1 === undefined ||
    lon1 === null || lon1 === undefined ||
    lat2 === null || lat2 === undefined ||
    lon2 === null || lon2 === undefined
  ) {
    return 0;
  }

  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c);
};

/**
 * Calculates formatted distance string for the HUD (e.g. '350 M' or '1.4 KM').
 */
export const formatTacticalDistance = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return "0 M";
  const distance = calculateDistanceMeters(lat1, lon1, lat2, lon2);
  return distance > 1000 ? `${(distance / 1000).toFixed(1)} KM` : `${distance} M`;
};

/**
 * Calculates bracketed tactical distance string (e.g. '[ 350 M ]' or '[ 1.40 KM ]').
 */
export const formatTacticalDistanceBracketed = (lat1, lon1, lat2, lon2) => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return '[ SIGNAL_LOST ]';
  const distance = calculateDistanceMeters(lat1, lon1, lat2, lon2);
  if (distance > 1000) {
    return `[ ${(distance / 1000).toFixed(2)} KM ]`;
  }
  return `[ ${Math.floor(distance)} M ]`;
};

/**
 * Calculates Great-Circle bearing between two coordinates in degrees (0 - 360).
 */
export const calculateBearing = (lat1, lng1, lat2, lng2) => {
  if (
    lat1 === null || lat1 === undefined ||
    lng1 === null || lng1 === undefined ||
    lat2 === null || lat2 === undefined ||
    lng2 === null || lng2 === undefined
  ) {
    return 0;
  }

  const dLng = toRad(lng2 - lng1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const y = Math.sin(dLng) * Math.cos(rLat2);
  const x = Math.cos(rLat1) * Math.sin(rLat2) - Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLng);

  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
};

/**
 * Shortest signed angle (within [-180, 180]) that turns `from` into `to`, across the
 * 0° / 360° north boundary: angularDifference(10, 350) is 20, not -340. Positive is
 * clockwise. The one copy of this math; normalizeRotationDelta and useDeviceHeading use it.
 */
export const angularDifference = (to, from) => {
  const normTo = ((to % 360) + 360) % 360;
  const normFrom = ((from % 360) + 360) % 360;
  let delta = normTo - normFrom;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
};

/**
 * Computes the shortest signed angular delta (within [-180, 180]) to prevent wraparound
 * spinning when crossing the 0° / 360° north boundary. Same math as angularDifference,
 * named for its job of animating a displayed rotation.
 */
export const normalizeRotationDelta = (targetAngle, currentAngle) => angularDifference(targetAngle, currentAngle);

/**
 * Dead Reckoning kinematic engine:
 * Projects an operative's estimated location after a signal disconnect based on
 * last known velocity, heading, and elapsed time delta in seconds.
 */
export const projectGhostLocation = (lat, lng, speedKmh, headingDegrees, timeDeltaSeconds) => {
  if (!lat || !lng) return { lat: 0, lng: 0 };
  if (!speedKmh || speedKmh < 1 || !timeDeltaSeconds || timeDeltaSeconds <= 0) {
    return { lat, lng };
  }

  // Convert km/h to m/s, then multiply by elapsed seconds
  const distanceMeters = (speedKmh * (5 / 18)) * timeDeltaSeconds;

  const radLat = toRad(lat);
  const radLng = toRad(lng);
  const radHeading = toRad(headingDegrees || 0);

  const projectedLat = Math.asin(
    Math.sin(radLat) * Math.cos(distanceMeters / EARTH_RADIUS_METERS) +
    Math.cos(radLat) * Math.sin(distanceMeters / EARTH_RADIUS_METERS) * Math.cos(radHeading)
  );

  const projectedLng = radLng + Math.atan2(
    Math.sin(radHeading) * Math.sin(distanceMeters / EARTH_RADIUS_METERS) * Math.cos(radLat),
    Math.cos(distanceMeters / EARTH_RADIUS_METERS) - Math.sin(radLat) * Math.sin(projectedLat)
  );

  return {
    lat: toDeg(projectedLat),
    lng: toDeg(projectedLng)
  };
};
