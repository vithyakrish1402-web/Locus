// Real walking-route fetchers for useWalkingRoute.js and turn-by-turn navigation.
// Both resolve to { path, distance, duration, steps, isRealRoute: true } on success
// or null on any failure (network error, no route found, service unavailable),
// so the caller can fall back to the straight-line route uniformly regardless
// of which engine or provider failed.

import { normalizeManeuverModifier, generateStepsFromPath } from './navGeometry';

// google.maps.DirectionsService — used on the primary engine.
export const fetchGoogleWalkingRoute = (origin, destination) =>
  new Promise((resolve) => {
    if (!window.google?.maps) {
      resolve(null);
      return;
    }
    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin,
        destination,
        travelMode: window.google.maps.TravelMode.WALKING,
      },
      (result, status) => {
        const route = status === 'OK' ? result?.routes?.[0] : null;
        if (!route) {
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
  });

// OSRM's public foot-profile demo server — used on the Leaflet fallback
const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/foot';
const OSRM_WALKING_SPEED_MPS = 1.4; // ~5 km/h

export const fetchOsrmWalkingRoute = async (origin, destination) => {
  try {
    const url = `${OSRM_BASE_URL}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.code === 'Ok' ? data.routes?.[0] : null;
    if (!route) return null;

    // GeoJSON coordinates are [lng, lat]
    const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const meters = route.distance;
    const minutes = Math.max(1, Math.round(meters / OSRM_WALKING_SPEED_MPS / 60));

    const osrmLeg = route.legs?.[0];
    const rawSteps = osrmLeg?.steps || [];
    const steps = rawSteps.map((step, idx) => {
      const maneuverType = step.maneuver?.type;
      const modifier = step.maneuver?.modifier;
      const maneuver = normalizeManeuverModifier(modifier, maneuverType);

      let text = step.name ? `Walk on ${step.name}` : 'Continue along path';
      if (maneuverType === 'arrive') text = destination?.name ? `Arrive at ${destination.name}` : 'Arrive at destination';
      else if (maneuverType === 'depart') text = 'Head out';
      else if (modifier) text = `${modifier.replace('-', ' ')} ${step.name ? `onto ${step.name}` : ''}`.trim();

      return {
        id: `osrm-step-${idx}`,
        instruction: text.charAt(0).toUpperCase() + text.slice(1),
        maneuver,
        distanceMeters: Math.round(step.distance || 0),
        startLocation: step.maneuver?.location ? { lat: step.maneuver.location[1], lng: step.maneuver.location[0] } : null,
        endLocation: null,
      };
    });

    return {
      path,
      distance: { text: meters > 1000 ? `${(meters / 1000).toFixed(2)} KM` : `${Math.round(meters)} M` },
      duration: { text: `${minutes} MIN${minutes === 1 ? '' : 'S'}` },
      distanceMeters: Math.round(meters),
      durationSeconds: minutes * 60,
      steps: steps.length > 0 ? steps : generateStepsFromPath(path, destination?.name),
      isRealRoute: true,
    };
  } catch {
    return null;
  }
};

