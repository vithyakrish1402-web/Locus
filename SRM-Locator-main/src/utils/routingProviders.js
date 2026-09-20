// Real walking-route fetchers for useWalkingRoute.js — one per map engine.
// Both resolve to { path, distance, duration, isRealRoute: true } on success
// or null on any failure (network error, no route found, service unavailable),
// so the caller can fall back to the straight-line route uniformly regardless
// of which engine or provider failed.

// google.maps.DirectionsService — used on the primary engine. Deliberately
// NOT using DirectionsRenderer: its default blue-line-plus-pin-markers look
// clashes with the tactical HUD styling and would add UI we don't control, so
// the path is pulled out of the result and fed into our own styled Polyline
// instead (see useWaypointNavigationLine.js).
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
        resolve({
          path: route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() })),
          distance: leg?.distance?.text ? { text: leg.distance.text.toUpperCase() } : null,
          duration: leg?.duration?.text ? { text: leg.duration.text.toUpperCase() } : null,
          isRealRoute: true,
        });
      }
    );
  });

// OSRM's public foot-profile demo server — used on the Leaflet fallback
// engine, which has no native walking-directions support of its own.
//
// FLAG: router.project-osrm.org is a free demo instance — it's rate-limited
// and explicitly not licensed for production traffic (see their usage
// policy). Fine for now/testing, but a real deployment beyond a handful of
// testers needs either a self-hosted OSRM instance or a paid routing API.
const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/foot';

// Verified against the live demo server: identical distance AND duration
// come back for /foot/ and /driving/ requests over the same two points — this
// public instance doesn't actually apply a pedestrian speed profile, it just
// serves the same (car-speed) network for every travel mode. The path
// geometry it returns still prefers walkable ways, so distance is trustworthy;
// duration is not, so it's recomputed here from that distance at an assumed
// walking pace instead of trusting OSRM's number.
const OSRM_WALKING_SPEED_MPS = 1.4; // ~5 km/h, matches this app's existing straight-line ETA assumption

export const fetchOsrmWalkingRoute = async (origin, destination) => {
  try {
    const url = `${OSRM_BASE_URL}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data.code === 'Ok' ? data.routes?.[0] : null;
    if (!route) return null;

    // GeoJSON coordinates are [lng, lat] — the opposite of this app's usual lat/lng order.
    const path = route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const meters = route.distance;
    const minutes = Math.max(1, Math.round(meters / OSRM_WALKING_SPEED_MPS / 60));
    return {
      path,
      distance: { text: meters > 1000 ? `${(meters / 1000).toFixed(2)} KM` : `${Math.round(meters)} M` },
      duration: { text: `${minutes} MIN${minutes === 1 ? '' : 'S'}` },
      isRealRoute: true,
    };
  } catch {
    // Network failure, CORS issue, rate-limit response body that isn't JSON, etc.
    return null;
  }
};
