// Real walking-route fetchers for useWalkingRoute.js and turn-by-turn navigation.
// Both resolve to { path, distance, duration, steps, isRealRoute: true } on success
// or null on any failure (network error, no route found, service unavailable),
// so the caller can fall back to the straight-line route uniformly regardless
// of which engine or provider failed.

import { normalizeManeuverModifier, generateStepsFromPath, haversineMeters } from './navGeometry';
import { findCampusPedestrianRoute } from '../data/campusPedestrianGraph';
import { formatDistanceMeters, formatDurationMinutes } from './walkingRoute';


// --- ROUTING CONFIG ---------------------------------------------------------
// Free routers first, Google only when both of them have nothing, and at most once per
// route request. Everything that tunes that lives here.

// Free walking routers, tried in this order. Both are public, volunteer-run servers with a
// fair-use policy, not services the app pays for, so go easy on them.
//  - routing.openstreetmap.de (FOSSGIS) runs a real foot profile. Its path says "driving"
//    because that is what the service calls its one profile; the data behind it is foot.
//  - router.project-osrm.org is the OSRM demo server. Assumption: it ignores the "foot" in
//    the URL and routes for cars (its times on SRM pairs are driving speed), so it is the
//    second choice: a road path is better than none.
const FREE_ROUTER_ENDPOINTS = [
  (o, d) => `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${o};${d}?overview=full&geometries=geojson&steps=true`,
  (o, d) => `https://router.project-osrm.org/route/v1/foot/${o};${d}?overview=full&geometries=geojson&steps=true`,
];
/** How long to wait for each free router before trying the next. */
const FREE_ROUTER_TIMEOUT_MS = 6000;

/** Decimal places endpoints are rounded to for the cache key: 4 is about 11 m. Moving less
 *  than that never asks for a new route. */
const ROUTE_CACHE_ROUNDING_DECIMALS = 4;
/** How long a route from a real router (free or Google) is reused. Assumption: campus paths
 *  do not change within a walk, and a person off the route is handled by the navigation
 *  controller moving the origin, which changes the key. */
const ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
/** How long the offline campus-graph fallback is reused. Short, so the next call retries the
 *  real routers once they are back, but long enough that a blocked service is not hammered. */
const FALLBACK_ROUTE_TTL_MS = 30 * 1000;
/** Minimum time between network lookups for the same destination. Inside it, a request for
 *  that destination from a new spot gets the latest route back instead of a new request.
 *  Assumption: the callers already re-ask every 6-20 s, so 8 s only stops bursts. */
const ROUTE_MIN_GAP_MS = 8000;
/** Most routes kept; the oldest is dropped first. */
const ROUTE_CACHE_MAX_ENTRIES = 50;

// google.maps.DirectionsService — kept for callers outside the route order below (unused there).
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

  const endpoints = FREE_ROUTER_ENDPOINTS.map((url) => url(`${oLng},${oLat}`, `${dLng},${dLat}`));

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FREE_ROUTER_TIMEOUT_MS) });
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

const GOOGLE_MAPS_API_KEY = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY || '';

export function decodePolyline(encoded) {
  if (!encoded) return [];
  const points = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;
  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({ lat: +(lat / 1e5).toFixed(6), lng: +(lng / 1e5).toFixed(6) });
  }
  return points;
}

/**
 * Google Routes API (v2 / New) — computes the direct, most suitable campus pedestrian path
 * using the project's modern API key.
 */
export const fetchGoogleRoutesApi = async (origin, destination) => {
  if (!GOOGLE_MAPS_API_KEY) return null;
  const oLat = Number(origin.lat);
  const oLng = Number(origin.lng);
  const dLat = Number(destination.lat);
  const dLng = Number(destination.lng);

  if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
    return null;
  }

  try {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: oLat, longitude: oLng } } },
        destination: { location: { latLng: { latitude: dLat, longitude: dLng } } },
        travelMode: 'WALK',
        languageCode: 'en-US',
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn('[routing] Routes API response status:', res.status);
      return null;
    }

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) return null;

    const path = decodePolyline(route.polyline?.encodedPolyline);
    if (!path || path.length < 2) return null;

    const meters = route.distanceMeters || 0;
    const durationSeconds = parseInt(route.duration?.replace('s', '') || '0', 10) || Math.round(meters / 1.4);
    const minutes = Math.max(1, Math.round(durationSeconds / 60));

    const rawSteps = route.legs?.[0]?.steps || [];
    const steps = rawSteps.map((step, idx) => {
      const gManeuver = step.navigationInstruction?.maneuver;
      let maneuver = 'straight';
      if (gManeuver) {
        const m = gManeuver.toLowerCase();
        if (m.includes('depart')) maneuver = 'depart';
        else if (m.includes('arrive')) maneuver = 'arrive';
        else if (m.includes('uturn')) maneuver = 'uturn';
        else if (m.includes('slight_left') || m.includes('slight-left')) maneuver = 'turn-slight-left';
        else if (m.includes('slight_right') || m.includes('slight-right')) maneuver = 'turn-slight-right';
        else if (m.includes('sharp_left') || m.includes('sharp-left')) maneuver = 'turn-sharp-left';
        else if (m.includes('sharp_right') || m.includes('sharp-right')) maneuver = 'turn-sharp-right';
        else if (m.includes('left')) maneuver = 'turn-left';
        else if (m.includes('right')) maneuver = 'turn-right';
        else if (m.includes('roundabout')) maneuver = 'roundabout';
      }

      const rawLines = (step.navigationInstruction?.instructions || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.toLowerCase().includes('restricted usage'));
      const instruction = rawLines[0] || (destination?.name ? `Head toward ${destination.name}` : 'Continue on path');

      const startLoc = step.startLocation?.latLng
        ? { lat: step.startLocation.latLng.latitude, lng: step.startLocation.latLng.longitude }
        : null;
      const endLoc = step.endLocation?.latLng
        ? { lat: step.endLocation.latLng.latitude, lng: step.endLocation.latLng.longitude }
        : null;

      return {
        id: `google-routes-step-${idx}`,
        instruction,
        maneuver,
        distanceMeters: step.distanceMeters || 0,
        distanceText: step.distanceMeters > 1000 ? `${(step.distanceMeters / 1000).toFixed(1)} km` : `${Math.round(step.distanceMeters || 0)} m`,
        durationText: `${Math.max(1, Math.round((step.distanceMeters || 0) / 1.4 / 60))} min`,
        startLocation: startLoc,
        endLocation: endLoc,
      };
    });

    return {
      path,
      distance: { text: meters > 1000 ? `${(meters / 1000).toFixed(2)} KM` : `${meters} M` },
      duration: { text: `${minutes} MIN${minutes === 1 ? '' : 'S'}` },
      distanceMeters: meters,
      durationSeconds,
      steps: steps.length > 0 ? steps : generateStepsFromPath(path, destination?.name),
      isRealRoute: true,
    };
  } catch (err) {
    console.warn('[routing] Routes API error:', err);
    return null;
  }
};

const roundCoord = (n) => Number(n).toFixed(ROUTE_CACHE_ROUNDING_DECIMALS);
const pointKey = (p) => `${roundCoord(p.lat)},${roundCoord(p.lng)}`;

// Shared by every caller (navigation, the group walking line, your own walking line), so
// three of them asking for the same route make one request.
const routeCache = new Map();     // routeKey -> { route, expires }
const routeInFlight = new Map();  // routeKey -> Promise
const lastLookupByDest = new Map(); // destKey -> { at, promise }

/** Forgets every cached route and lookup time (sign-out, and tests). */
export const clearRouteCache = () => {
  routeCache.clear();
  routeInFlight.clear();
  lastLookupByDest.clear();
};

const remember = (key, route, ttl) => {
  routeCache.delete(key);
  routeCache.set(key, { route, expires: Date.now() + ttl });
  while (routeCache.size > ROUTE_CACHE_MAX_ENTRIES) routeCache.delete(routeCache.keys().next().value);
};

// How long the online routers get, all together, before the campus graph answers. Each has its
// own timeout, and on a network that hangs (a captive portal) they used to add up to ~18 s.
export const OFFLINE_ROUTE_TIMEOUT_MS = 8000;

// The online routers in order: free ones, then Google once. A route, or null.
const lookUpOnline = async (origin, destination) => {
  // 1-2. OpenStreetMap foot router, then the OSRM demo server.
  try {
    const free = await fetchOsrmWalkingRoute(origin, destination);
    if (free?.path?.length >= 2) return free;
  } catch {
    // Go on to Google
  }

  // 3. Google Routes API: one request, only because neither free router had a route.
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const google = await fetchGoogleRoutesApi(origin, destination);
      if (google?.path?.length >= 2) return google;
    } catch {
      // Go on to the campus graph
    }
  }
  return null;
};

// Consecutive points at the same spot made as one. The campus graph's path ends on a node that is
// the destination itself, and two identical points have no bearing (0, "north"), which put a
// "Turn left" of 0 m before "Arrive".
const withoutRepeats = (path) => path.filter((point, i) => i === 0 || haversineMeters(path[i - 1], point) > 0.5);

// The route itself, no cache: the online routers (up to OFFLINE_ROUTE_TIMEOUT_MS), then the campus graph.
const lookUpRoute = async (origin, destination) => {
  let timer;
  const online = await Promise.race([
    lookUpOnline(origin, destination),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), OFFLINE_ROUTE_TIMEOUT_MS); }),
  ]);
  clearTimeout(timer);
  if (online) return { route: online, ttl: ROUTE_CACHE_TTL_MS };

  // 4. Curated campus pedestrian graph fallback (offline).
  const found = findCampusPedestrianRoute(origin, destination);
  const campusPath = found ? withoutRepeats(found) : null;
  if (campusPath && campusPath.length >= 2) {
    const steps = generateStepsFromPath(campusPath, destination?.name);
    let meters = 0;
    for (let i = 0; i < campusPath.length - 1; i++) {
      meters += haversineMeters(campusPath[i], campusPath[i + 1]);
    }
    const mins = Math.max(1, Math.round(meters / 1.4 / 60));
    return {
      route: {
        path: campusPath,
        steps,
        distance: { text: formatDistanceMeters(meters) },
        duration: { text: formatDurationMinutes(mins) },
        distanceMeters: meters,
        durationSeconds: mins * 60,
        isRealRoute: true,
        // Straight lines between hand-placed campus points, ending at a building's centre: fine
        // on the map, but AR Scan drew it as a road straight through buildings (arRoadLine.js).
        fromCampusGraph: true,
      },
      ttl: FALLBACK_ROUTE_TTL_MS,
    };
  }

  return null;
};

/**
 * Walking route between two points, shared and cached.
 *   cache (rounded endpoints) -> a lookup already running -> the minimum gap for this
 *   destination -> lookUpRoute(): OSM foot router, OSRM demo server, Google (once), campus graph.
 * `preferredEngine` is accepted for the existing callers and ignored: the route does not
 * depend on which map is showing.
 */
export const fetchPedestrianRoute = async (origin, destination) => {
  if (!origin || !destination) return null;
  if (![origin.lat, origin.lng, destination.lat, destination.lng].every((n) => Number.isFinite(Number(n)))) return null;

  const destKey = pointKey(destination);
  const key = `${pointKey(origin)}>${destKey}|${destination.name || ''}`;
  const now = Date.now();

  const cached = routeCache.get(key);
  if (cached && cached.expires > now) return cached.route;

  const running = routeInFlight.get(key);
  if (running) return running;

  // Too soon after the last lookup for this destination (running or done): its answer is
  // this one's too, rather than another request.
  const last = lastLookupByDest.get(destKey);
  if (last && now - last.at < ROUTE_MIN_GAP_MS) return last.promise;

  const lookup = lookUpRoute(origin, destination)
    .then((found) => {
      if (found) remember(key, found.route, found.ttl);
      return found?.route ?? null;
    })
    .finally(() => routeInFlight.delete(key));
  routeInFlight.set(key, lookup);
  lastLookupByDest.set(destKey, { at: now, promise: lookup });
  return lookup;
};
