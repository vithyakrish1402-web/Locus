// Real walking-route fetchers for useWalkingRoute.js and turn-by-turn navigation.
// Both resolve to { path, distance, duration, steps, isRealRoute: true } on success
// or null on any failure (network error, no route found, service unavailable),
// so the caller can fall back to the straight-line route uniformly regardless
// of which engine or provider failed.

import { normalizeManeuverModifier, generateStepsFromPath, haversineMeters } from './navGeometry';
import { findCampusPedestrianRoute } from '../data/campusPedestrianGraph';
import { formatDistanceMeters, formatDurationMinutes } from './walkingRoute';

// google.maps.DirectionsService — used on the primary engine.
export const fetchGoogleWalkingRoute = (origin, destination) =>
  new Promise((resolve) => {
    if (!window.google?.maps) {
      resolve(null);
      return;
    }
    try {
      const directionsService = new window.google.maps.DirectionsService();
      const originPoint = { lat: Number(origin.lat), lng: Number(origin.lng) };
      const destPoint = { lat: Number(destination.lat), lng: Number(destination.lng) };

      directionsService.route(
        {
          origin: originPoint,
          destination: destPoint,
          travelMode: window.google.maps.TravelMode.WALKING,
        },
        (result, status) => {
          const route = status === 'OK' ? result?.routes?.[0] : null;
          if (!route) {
            console.warn('[routing] Google Directions returned status:', status);
            resolve(null);
            return;
          }
          const leg = route.legs?.[0];
          const path = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));

          const rawSteps = leg?.steps || [];
          const steps = rawSteps.map((step, idx) => {
            // Clean HTML tags from Google instruction strings like "Turn <b>right</b> onto <b>Main St</b>"
            const cleanText = (step.instructions || '')
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

            const maneuver = normalizeManeuverModifier(step.maneuver, step.maneuver);

            return {
              id: `google-step-${idx}`,
              instruction: cleanText || 'Continue along path',
              maneuver,
              distanceMeters: step.distance?.value || 0,
              distanceText: step.distance?.text || '',
              durationText: step.duration?.text || '',
              startLocation: step.start_location ? { lat: step.start_location.lat(), lng: step.start_location.lng() } : null,
              endLocation: step.end_location ? { lat: step.end_location.lat(), lng: step.end_location.lng() } : null,
            };
          });

          // Ensure there is an arrival step at the end if not present
          if (steps.length > 0 && steps[steps.length - 1].maneuver !== 'arrive') {
            const destLoc = path[path.length - 1];
            steps.push({
              id: `google-step-arrive`,
              instruction: destination?.name ? `Arrive at ${destination.name}` : 'Arrive at destination',
              maneuver: 'arrive',
              distanceMeters: 0,
              distanceText: '0 M',
              durationText: '0 MIN',
              startLocation: destLoc,
              endLocation: destLoc,
            });
          }

          resolve({
            path,
            distance: leg?.distance?.text ? { text: leg.distance.text.toUpperCase() } : null,
            duration: leg?.duration?.text ? { text: leg.duration.text.toUpperCase() } : null,
            distanceMeters: leg?.distance?.value || 0,
            durationSeconds: leg?.duration?.value || 0,
            steps: steps.length > 0 ? steps : generateStepsFromPath(path, destination?.name),
            isRealRoute: true,
          });
        }
      );
    } catch (err) {
      console.warn('[routing] Google Directions call error:', err);
      resolve(null);
    }
  });

// OSRM & OpenStreetMap foot routers — has complete road geometry for campus roads,
// Intra College Rd, walkways, and lanes.
const OSRM_WALKING_SPEED_MPS = 1.4; // ~5 km/h

export const fetchOsrmWalkingRoute = async (origin, destination) => {
  const oLat = Number(origin.lat);
  const oLng = Number(origin.lng);
  const dLat = Number(destination.lat);
  const dLng = Number(destination.lng);

  if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
    return null;
  }

  const endpoints = [
    `https://router.project-osrm.org/route/v1/foot/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`,
    `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const data = await res.json();
      const route = data.code === 'Ok' ? data.routes?.[0] : null;
      if (!route || !route.geometry?.coordinates?.length) continue;

      // GeoJSON coordinates are [lng, lat]
      const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
      const meters = Math.round(route.distance || 0);
      const minutes = Math.max(1, Math.round(meters / OSRM_WALKING_SPEED_MPS / 60));

      const osrmLeg = route.legs?.[0];
      const rawSteps = osrmLeg?.steps || [];
      const steps = rawSteps.map((step, idx) => {
        const maneuverType = step.maneuver?.type;
        const modifier = step.maneuver?.modifier;
        const maneuver = normalizeManeuverModifier(modifier, maneuverType);

        let text = step.name ? `Walk on ${step.name}` : 'Continue along path';
        if (maneuverType === 'arrive') text = destination?.name ? `Arrive at ${destination.name}` : 'Arrive at destination';
        else if (maneuverType === 'depart') text = step.name ? `Head out on ${step.name}` : 'Head out';
        else if (modifier) text = `${modifier.replace('-', ' ')} ${step.name ? `onto ${step.name}` : ''}`.trim();

        const startLocation = step.maneuver?.location
          ? { lat: step.maneuver.location[1], lng: step.maneuver.location[0] }
          : null;
        const nextRawStep = rawSteps[idx + 1];
        const endLocation = nextRawStep?.maneuver?.location
          ? { lat: nextRawStep.maneuver.location[1], lng: nextRawStep.maneuver.location[0] }
          : (path[path.length - 1] || null);

        return {
          id: `osrm-step-${idx}`,
          instruction: text.charAt(0).toUpperCase() + text.slice(1),
          maneuver,
          distanceMeters: Math.round(step.distance || 0),
          distanceText: step.distance > 1000 ? `${(step.distance / 1000).toFixed(1)} km` : `${Math.round(step.distance)} m`,
          durationText: `${Math.max(1, Math.round((step.distance || 0) / OSRM_WALKING_SPEED_MPS / 60))} min`,
          startLocation,
          endLocation,
        };
      });

      return {
        path,
        distance: { text: meters > 1000 ? `${(meters / 1000).toFixed(2)} KM` : `${meters} M` },
        duration: { text: `${minutes} MIN${minutes === 1 ? '' : 'S'}` },
        distanceMeters: meters,
        durationSeconds: minutes * 60,
        steps: steps.length > 0 ? steps : generateStepsFromPath(path, destination?.name),
        isRealRoute: true,
      };
    } catch {
      // Try next endpoint
    }
  }

  return null;
};

/**
 * Unified optimal walking route provider.
 * Follows real roads by priority:
 * 1. Google Directions (if available)
 * 2. OpenStreetMap / OSRM foot router (contains all campus roads and walkways)
 * 3. Campus pedestrian graph fallback
 */
export const fetchPedestrianRoute = async (origin, destination, preferredEngine = 'google') => {
  if (!origin || !destination) return null;

  // 1. Google Maps walking directions (when enabled and available)
  if (preferredEngine === 'google' && window.google?.maps) {
    try {
      const googleRoute = await fetchGoogleWalkingRoute(origin, destination);
      if (googleRoute?.path?.length >= 2) {
        return googleRoute;
      }
    } catch {
      // Proceed to OSM road router
    }
  }

  // 2. OpenStreetMap / OSRM foot router (follows Intra College Rd, campus avenues, paths)
  try {
    const osrmRoute = await fetchOsrmWalkingRoute(origin, destination);
    if (osrmRoute?.path?.length >= 2) {
      return osrmRoute;
    }
  } catch {
    // Proceed to campus graph
  }

  // 3. Curated campus pedestrian graph fallback
  const campusPath = findCampusPedestrianRoute(origin, destination);
  if (campusPath && campusPath.length >= 2) {
    const steps = generateStepsFromPath(campusPath, destination?.name);
    let meters = 0;
    for (let i = 0; i < campusPath.length - 1; i++) {
      meters += haversineMeters(campusPath[i], campusPath[i + 1]);
    }
    const mins = Math.max(1, Math.round(meters / 1.4 / 60));
    return {
      path: campusPath,
      steps,
      distance: { text: formatDistanceMeters(meters) },
      duration: { text: formatDurationMinutes(mins) },
      distanceMeters: meters,
      durationSeconds: mins * 60,
      isRealRoute: true,
    };
  }

  return null;
};


