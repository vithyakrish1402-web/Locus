import { useState, useEffect, useRef, useCallback } from 'react';
import { haversineMeters, findNearestPointOnPath, interpolateHeading } from '../utils/navGeometry';
import { fetchPedestrianRoute } from '../utils/routingProviders';
import { isMapAttached } from '../utils/mapAttached';

// Configurable thresholds for campus navigation
export const OFF_ROUTE_THRESHOLD_M = 25;       // Sustained distance from path before rerouting
export const OFF_ROUTE_CONFIRMATION_SAMPLES = 3;// Consecutive samples required to confirm deviation
export const ARRIVAL_DISTANCE_THRESHOLD_M = 15; // Within 15 meters considered reached destination
export const MANEUVER_ADVANCE_DISTANCE_M = 18;  // Switch to next maneuver within 18m of current waypoint
export const MIN_REROUTE_INTERVAL_MS = 6000;    // Minimum time between reroute requests (debounce)
// Reroutes in a row that never bring you back onto the route before it stops and says so. Far
// from any mapped path (deep inside a building), every route starts where the path is, never
// where you are: it used to say "Recalculating…" every few seconds, for good.
export const REROUTE_MAX_TRIES = 3;
// Why a route could not be had, for the card to say (components/navigation/NavigationHUD.jsx).
export const ROUTE_FAILURE = { noRoute: 'no-route', unavailable: 'unavailable', noMappedPath: 'no-mapped-path' };

export function useNavigationController({
  isNavigating,
  destination,
  liveLocation,
  liveHeading,
  speedMps,
  mapEngine = 'google', // 'google' | 'leaflet'
  mapInstance = null,
}) {
  const [activeRoute, setActiveRoute] = useState(null);
  const [isRerouting, setIsRerouting] = useState(false);
  const [rerouteError, setRerouteError] = useState(null);
  const [hasArrived, setHasArrived] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [autoFollow, setAutoFollow] = useState(false); // Enabled for each new navigation session.
  const [isFollowingCamera, setIsFollowingCamera] = useState(false);
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState(0);
  const [remainingTimeMinutes, setRemainingTimeMinutes] = useState(0);
  const [distanceToNextStepMeters, setDistanceToNextStepMeters] = useState(0);

  // Consecutive off-route counter
  const offRouteCountRef = useRef(0);
  const rerouteTriesRef = useRef(0); // reroutes since last on the route (REROUTE_MAX_TRIES)
  const lastRerouteTimeRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const hasInitialCenteredRef = useRef(false);
  const destinationRef = useRef(destination);
  destinationRef.current = destination;

  const activeRouteRef = useRef(activeRoute);
  activeRouteRef.current = activeRoute;
  const requestIdRef = useRef(0);
  const sessionKeyRef = useRef(null);
  const cameraFrameRef = useRef(null);

  useEffect(() => () => {
    requestIdRef.current += 1;
  }, []);

  // A map whose engine has gone is never moved (utils/mapAttached.js).
  useEffect(() => {
    if (!isNavigating && isMapAttached(mapInstance)) {
      if (mapEngine === 'leaflet') mapInstance?.setBearing?.(0);
      else mapInstance?.setHeading?.(0);
    }
  }, [isNavigating, mapEngine, mapInstance]);

  // Route calculation function
  const triggerRouteCalculation = useCallback(async (origin, dest) => {
    if (!origin || !dest) return;
    const now = Date.now();
    if (now - lastRerouteTimeRef.current < MIN_REROUTE_INTERVAL_MS && activeRouteRef.current) return;
    if (rerouteInFlightRef.current) return;

    const requestId = ++requestIdRef.current;
    rerouteInFlightRef.current = true;
    setIsRerouting(true);
    setRerouteError(null);
    lastRerouteTimeRef.current = now;

    try {
      // Routes do not depend on which map is showing: switching to satellite must not
      // restart the route, so the engine is not part of the request or the session.
      const route = await fetchPedestrianRoute(origin, dest, 'leaflet');

      // Check if destination is still valid
      if (requestId === requestIdRef.current && destinationRef.current?.lat === dest.lat && destinationRef.current?.lng === dest.lng) {
        if (route && route.path && route.path.length > 0) {
          // Back to the first instruction only for a different route. The same one comes back
          // from the cache (or a lookup a moment ago), and starting its instructions over sent
          // the card back to the first turn on every reroute.
          if (route !== activeRouteRef.current) {
            setActiveRoute(route);
            setCurrentStepIndex(0);
          }
          offRouteCountRef.current = 0;
          setRerouteError(null);
        } else {
          setRerouteError(ROUTE_FAILURE.noRoute);
        }
      }
    } catch {
      if (requestId === requestIdRef.current) setRerouteError(ROUTE_FAILURE.unavailable);
    } finally {
      if (requestId === requestIdRef.current) {
        rerouteInFlightRef.current = false;
        setIsRerouting(false);
      }
    }
  }, []);

  // Reset session when navigation starts or destination changes
  useEffect(() => {
    const sessionKey = isNavigating && destination ? `${destination.lat},${destination.lng}` : null;
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      requestIdRef.current += 1; // Invalidate responses for a stopped/replaced session.
      rerouteInFlightRef.current = false;
      lastRerouteTimeRef.current = 0;
      rerouteTriesRef.current = 0;
      activeRouteRef.current = null;
      setActiveRoute(null);
      hasInitialCenteredRef.current = false;
      setAutoFollow(Boolean(sessionKey));
    }
    if (!isNavigating || !destination) {
      setActiveRoute(null);
      setIsRerouting(false);
      setRerouteError(null);
      setHasArrived(false);
      setCurrentStepIndex(0);
      setAutoFollow(false);
      setIsFollowingCamera(false);
      hasInitialCenteredRef.current = false;
      offRouteCountRef.current = 0;
      return;
    }

    setHasArrived(false);
    offRouteCountRef.current = 0;
    setCurrentStepIndex(0);

    // Initial route fetch
    if (liveLocation) {
      triggerRouteCalculation(liveLocation, destination);
    }
  }, [isNavigating, destination?.lat, destination?.lng, triggerRouteCalculation]);

  // Automatically trigger route calculation as soon as liveLocation arrives
  useEffect(() => {
    if (isNavigating && destination && liveLocation && !activeRoute && !rerouteInFlightRef.current) {
      triggerRouteCalculation(liveLocation, destination);
    }
  }, [isNavigating, destination?.lat, destination?.lng, liveLocation?.lat, liveLocation?.lng, activeRoute, triggerRouteCalculation]);

  // Handle location update, progress tracking, and deviation detection
  useEffect(() => {
    if (!isNavigating || !liveLocation || !activeRoute?.path?.length) return;

    const path = activeRoute.path;
    const destPoint = path[path.length - 1];
    const distanceToDestination = haversineMeters(liveLocation, destPoint);

    // 1. Arrival check
    if (distanceToDestination <= ARRIVAL_DISTANCE_THRESHOLD_M) {
      setHasArrived(true);
      setRemainingDistanceMeters(0);
      setRemainingTimeMinutes(0);
      return;
    }

    // 2. Nearest point on path & cross-track error
    const nearest = findNearestPointOnPath(liveLocation, path);
    setRemainingDistanceMeters(nearest.remainingDistanceMeters);
    const estMinutes = Math.max(1, Math.round(nearest.remainingDistanceMeters / 1.4 / 60));
    setRemainingTimeMinutes(estMinutes);

    // 3. Maneuver Step advancement
    const steps = activeRoute.steps || [];
    if (steps.length > 0 && currentStepIndex < steps.length) {
      const currentStep = steps[currentStepIndex];
      const targetPoint = currentStep.endLocation || steps[currentStepIndex + 1]?.startLocation || destPoint;
      const distToStepEnd = haversineMeters(liveLocation, targetPoint);
      setDistanceToNextStepMeters(distToStepEnd);

      if (distToStepEnd <= MANEUVER_ADVANCE_DISTANCE_M && currentStepIndex < steps.length - 1) {
        setCurrentStepIndex((prev) => prev + 1);
      }
    }

    // 4. Off-route detection with noise filtering
    // Account for GPS reported accuracy or jitter by requiring consecutive samples
    if (nearest.crossTrackDistance > OFF_ROUTE_THRESHOLD_M) {
      offRouteCountRef.current += 1;
      if (offRouteCountRef.current >= OFF_ROUTE_CONFIRMATION_SAMPLES) {
        // Sustained deviation confirmed -> trigger reroute, at most REROUTE_MAX_TRIES times in a
        // row; then it says there is no mapped path from here, and waits for a tap to try again.
        if (rerouteTriesRef.current >= REROUTE_MAX_TRIES) {
          setRerouteError(ROUTE_FAILURE.noMappedPath);
        } else if (!rerouteInFlightRef.current && destinationRef.current
          && Date.now() - lastRerouteTimeRef.current >= MIN_REROUTE_INTERVAL_MS) {
          rerouteTriesRef.current += 1;
          triggerRouteCalculation(liveLocation, destinationRef.current);
        }
      }
    } else {
      // User is on track, reset counter
      offRouteCountRef.current = 0;
      rerouteTriesRef.current = 0;
      // Walked back onto the route: "No mapped path from here" is no longer true.
      setRerouteError((error) => (error === ROUTE_FAILURE.noMappedPath ? null : error));
    }
  }, [isNavigating, liveLocation?.lat, liveLocation?.lng, activeRoute, currentStepIndex, triggerRouteCalculation]);

  // Recenter action: smoothly moves camera to user's live position & heading
  const handleRecenter = useCallback(() => {
    if (!liveLocation || !isMapAttached(mapInstance)) return;

    setAutoFollow(true);
    const targetCenter = { lat: liveLocation.lat, lng: liveLocation.lng };
    const targetHeading = liveHeading || 0;

    if (mapEngine === 'google') {
      if (typeof mapInstance.moveCamera === 'function') {
        mapInstance.moveCamera({
          center: targetCenter,
          zoom: 19,
          heading: targetHeading,
          tilt: 0, // flat: a tilted view put the route and markers out of line (js-1.1.72)
        });
      } else if (typeof mapInstance.panTo === 'function') {
        mapInstance.panTo(targetCenter);
        mapInstance.setZoom?.(19);
      }
    } else if (mapEngine === 'leaflet') {
      mapInstance.setBearing?.(-targetHeading);
      if (typeof mapInstance.flyTo === 'function') {
        mapInstance.flyTo([targetCenter.lat, targetCenter.lng], 19, { duration: 0.8 });
      } else if (typeof mapInstance.panTo === 'function') {
        mapInstance.panTo([targetCenter.lat, targetCenter.lng], { animate: true, duration: 0.4 });
      }
    }
  }, [liveLocation, liveHeading, mapEngine, mapInstance]);

  // Initial one-time centering when navigation starts
  useEffect(() => {
    if (isNavigating && liveLocation && mapInstance && !hasInitialCenteredRef.current) {
      hasInitialCenteredRef.current = true;
      handleRecenter();
    }
    if (!isNavigating) {
      hasInitialCenteredRef.current = false;
    }
  }, [isNavigating, liveLocation?.lat, liveLocation?.lng, mapInstance, handleRecenter]);

  // Animate the native map directly, without rerendering the app on every frame.
  // A new GPS fix starts at the current view; cleanup cancels old animation on drag/stop.
  useEffect(() => {
    if (!isNavigating || !autoFollow || !liveLocation || !isMapAttached(mapInstance)) return;
    const target = { lat: liveLocation.lat, lng: liveLocation.lng };
    if (mapEngine === 'google' && typeof mapInstance.moveCamera === 'function') {
      const center = mapInstance.getCenter?.();
      const from = { lat: center?.lat?.() ?? target.lat, lng: center?.lng?.() ?? target.lng };
      const fromHeading = mapInstance.getHeading?.() || 0;
      const toHeading = (speedMps || 0) > 0.6 && liveHeading != null ? liveHeading : fromHeading;
      const started = performance.now();
      const frame = (now) => {
        const t = Math.min(1, Math.max(0, (now - started) / 400));
        const eased = t * t * (3 - 2 * t);
        mapInstance.moveCamera({
          center: { lat: from.lat + (target.lat - from.lat) * eased, lng: from.lng + (target.lng - from.lng) * eased },
          heading: interpolateHeading(fromHeading, toHeading, eased),
        });
        if (t < 1) cameraFrameRef.current = requestAnimationFrame(frame);
      };
      cameraFrameRef.current = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(cameraFrameRef.current);
    }
    let bearingFrame;
    if (mapEngine === 'leaflet' && Number.isFinite(liveHeading) && mapInstance.setBearing) {
      const from = mapInstance.getBearing?.() || 0;
      const started = performance.now();
      const rotate = now => {
        if (!isMapAttached(mapInstance)) return;
        const t = Math.min(1, (now - started) / 300);
        mapInstance.setBearing(interpolateHeading(from, -liveHeading, t));
        if (t < 1) bearingFrame = requestAnimationFrame(rotate);
      };
      bearingFrame = requestAnimationFrame(rotate);
    }
    if (typeof mapInstance.panTo === 'function') {
      mapInstance.panTo(mapEngine === 'leaflet' ? [target.lat, target.lng] : target,
        { animate: true, duration: 0.4 });
    }
    return () => { if (bearingFrame) cancelAnimationFrame(bearingFrame); };
  }, [isNavigating, autoFollow, liveLocation?.lat, liveLocation?.lng, liveHeading, speedMps, mapEngine, mapInstance]);

  // Handle user manual interaction to disable continuous auto-centering
  const handleUserMapInteraction = useCallback(() => {
    setAutoFollow(false);
    setIsFollowingCamera(false);
  }, []);

  const toggleAutoFollow = useCallback(() => {
    if (autoFollow) setAutoFollow(false);
    else handleRecenter();
  }, [autoFollow, handleRecenter]);

  const currentStep = activeRoute?.steps?.[currentStepIndex] || activeRoute?.steps?.[0] || null;
  const nextStep = activeRoute?.steps?.[currentStepIndex + 1] || null;
  // What the turn card says (a fix, 2026-10-29). A step's instruction is the move made where the
  // step *starts*; distanceToNextStepMeters is to where the current one *ends*, which is where the
  // next move is made. The card used to pair the current step's instruction with that distance:
  // "200 m · Turn left" for a turn already behind you. It says the next move, and how far to it;
  // under it, the move after that, and the length of the stretch between the two.
  const steps = activeRoute?.steps || [];
  const upcomingStep = steps[currentStepIndex + 1] || currentStep;
  const stepAfter = steps[currentStepIndex + 2]
    ? { ...steps[currentStepIndex + 2], distanceMeters: steps[currentStepIndex + 1]?.distanceMeters ?? 0 }
    : null;

  return {
    activeRoute,
    isRerouting,
    rerouteError,
    hasArrived,
    currentStep,
    nextStep,
    upcomingStep,
    stepAfter,
    currentStepIndex,
    totalSteps: activeRoute?.steps?.length || 0,
    remainingDistanceMeters,
    remainingTimeMinutes,
    distanceToNextStepMeters,
    autoFollow,
    toggleAutoFollow,
    isFollowingCamera: autoFollow,
    handleUserMapInteraction,
    handleRecenter,
    // A tap to try again: a fresh set of tries, and at once (the debounce is for automatic ones).
    retryReroute: () => {
      if (!destinationRef.current || !liveLocation) return;
      rerouteTriesRef.current = 0;
      lastRerouteTimeRef.current = 0;
      triggerRouteCalculation(liveLocation, destinationRef.current);
    },
  };
}
