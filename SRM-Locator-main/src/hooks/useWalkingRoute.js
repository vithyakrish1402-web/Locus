import { useEffect, useRef, useState } from 'react';
import { fetchGoogleWalkingRoute, fetchOsrmWalkingRoute } from '../utils/routingProviders';
import { DRIFT_THRESHOLD_M, RECOMPUTE_INTERVAL_MS, haversineMeters, buildStraightLineRoute } from '../utils/walkingRoute';

/**
 * Live walking route from the operative's position to the active squad
 * waypoint — real path from a routing service when available, throttled so
 * it isn't recomputed on every GPS tick, with a straight-line fallback that
 * always renders something.
 *
 * Recomputes only when: the waypoint changes, the operative has drifted
 * DRIFT_THRESHOLD_M from where the current route was computed, or
 * RECOMPUTE_INTERVAL_MS has elapsed — whichever comes first. Returns
 * { path, distance, duration, isRealRoute }, or null if there's no live
 * position or no active waypoint at all.
 *
 * Known data-quality limitation, not fixable here: campus interior footpaths
 * (courtyards, small inter-building lanes) often aren't mapped as walkable
 * ways in the base road data either provider routes against, so the result
 * can still look a little off in tightly-packed interior areas. Should still
 * be dramatically better than the straight line it replaces in most cases.
 */
export function useWalkingRoute({ engine, liveLocation, activeWaypoint }) {
  // Tagged with the waypointKey it was computed for — lets a response that
  // resolves after the waypoint has already changed again be recognized as
  // stale and ignored at render time, without needing to reset state
  // synchronously inside the effect (a response landing for an abandoned
  // waypoint would otherwise briefly paint a route to the wrong destination).
  const [realRoute, setRealRoute] = useState(null);

  const lastFetchAtRef = useRef(0);
  const lastFetchFromRef = useRef(null);
  const lastFetchWaypointKeyRef = useRef(null);
  const fetchInFlightRef = useRef(false);

  const waypointKey = activeWaypoint ? `${activeWaypoint.lat},${activeWaypoint.lng}` : null;

  useEffect(() => {
    if (!liveLocation || !activeWaypoint) {
      lastFetchAtRef.current = 0;
      lastFetchFromRef.current = null;
      lastFetchWaypointKeyRef.current = null;
      return;
    }

    const waypointChanged = lastFetchWaypointKeyRef.current !== waypointKey;
    const now = Date.now();
    const driftMeters = lastFetchFromRef.current ? haversineMeters(lastFetchFromRef.current, liveLocation) : Infinity;
    const elapsedMs = now - lastFetchAtRef.current;
    const shouldFetch = waypointChanged || driftMeters > DRIFT_THRESHOLD_M || elapsedMs > RECOMPUTE_INTERVAL_MS;

    if (!shouldFetch || fetchInFlightRef.current) return;

    fetchInFlightRef.current = true;
    lastFetchAtRef.current = now;
    lastFetchFromRef.current = liveLocation;
    lastFetchWaypointKeyRef.current = waypointKey;
    const fetchedForKey = waypointKey;
    const fetcher = engine === 'google' ? fetchGoogleWalkingRoute : fetchOsrmWalkingRoute;

    fetcher(liveLocation, activeWaypoint).then((result) => {
      fetchInFlightRef.current = false;
      if (result) setRealRoute({ ...result, waypointKey: fetchedForKey });
      // On failure, leave realRoute untouched — the fallback below covers a
      // null/stale realRoute every render regardless of why it's missing.
    });
  }, [liveLocation, activeWaypoint, engine, waypointKey]);

  if (!liveLocation || !activeWaypoint) return null;
  if (realRoute && realRoute.waypointKey === waypointKey) return realRoute;
  // Recomputed fresh every render — cheap pure geometry, so it's fine to
  // track live position on every tick even though the real-route fetch above
  // is throttled. Also what covers a stale (wrong-waypoint) realRoute above.
  return buildStraightLineRoute(liveLocation, activeWaypoint);
}
