import { useState, useEffect, useRef, useCallback } from 'react';
import { haversineMeters, findNearestPointOnPath, interpolateHeading } from '../utils/navGeometry';
import { fetchPedestrianRoute } from '../utils/routingProviders';

// Configurable thresholds for campus navigation
export const OFF_ROUTE_THRESHOLD_M = 25;       // Sustained distance from path before rerouting
export const OFF_ROUTE_CONFIRMATION_SAMPLES = 3;// Consecutive samples required to confirm deviation
export const ARRIVAL_DISTANCE_THRESHOLD_M = 15; // Within 15 meters considered reached destination
export const MANEUVER_ADVANCE_DISTANCE_M = 18;  // Switch to next maneuver within 18m of current waypoint
export const MIN_REROUTE_INTERVAL_MS = 6000;    // Minimum time between reroute requests (debounce)

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
  const [autoFollow, setAutoFollow] = useState(false); // Manual recenter by default
  const [isFollowingCamera, setIsFollowingCamera] = useState(false);
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState(0);
  const [remainingTimeMinutes, setRemainingTimeMinutes] = useState(0);
  const [distanceToNextStepMeters, setDistanceToNextStepMeters] = useState(0);

  // Consecutive off-route counter
  const offRouteCountRef = useRef(0);
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
      const route = await fetchPedestrianRoute(origin, dest, mapEngine);

      // Check if destination is still valid
      if (requestId === requestIdRef.current && destinationRef.current?.lat === dest.lat && destinationRef.current?.lng === dest.lng) {
        if (route && route.path && route.path.length > 0) {
          setActiveRoute(route);
          setCurrentStepIndex(0);
          offRouteCountRef.current = 0;
          setRerouteError(null);
        } else {
          setRerouteError('Unable to find walking route to destination');
        }
      }
    } catch {
      if (requestId === requestIdRef.current) setRerouteError('Routing service unavailable');
    } finally {
      if (requestId === requestIdRef.current) {
        rerouteInFlightRef.current = false;
        setIsRerouting(false);
      }
    }
  }, [mapEngine]);

  // Reset session when navigation starts or destination changes
  useEffect(() => {
    const sessionKey = isNavigating && destination ? `${mapEngine}:${destination.lat},${destination.lng}` : null;
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      requestIdRef.current += 1; // Invalidate responses for a stopped/replaced session.
      rerouteInFlightRef.current = false;
      lastRerouteTimeRef.current = 0;
      activeRouteRef.current = null;
      setActiveRoute(null);
      hasInitialCenteredRef.current = false;
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
  }, [isNavigating, destination?.lat, destination?.lng, mapEngine, triggerRouteCalculation]);

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
        // Sustained deviation confirmed -> trigger reroute
        if (!rerouteInFlightRef.current && destinationRef.current) {
          triggerRouteCalculation(liveLocation, destinationRef.current);
        }
      }
    } else {
      // User is on track, reset counter
      offRouteCountRef.current = 0;
    }
  }, [isNavigating, liveLocation?.lat, liveLocation?.lng, activeRoute, currentStepIndex, triggerRouteCalculation]);

  // Recenter action: smoothly moves camera to user's live position & heading
  const handleRecenter = useCallback(() => {
    if (!liveLocation || !mapInstance) return;

    const targetCenter = { lat: liveLocation.lat, lng: liveLocation.lng };
    const targetHeading = liveHeading || 0;

    if (mapEngine === 'google') {
      if (typeof mapInstance.moveCamera === 'function') {
        mapInstance.moveCamera({
          center: targetCenter,
          zoom: 19,
          heading: targetHeading,
          tilt: 35,
        });
      } else if (typeof mapInstance.panTo === 'function') {
        mapInstance.panTo(targetCenter);
        mapInstance.setZoom?.(19);
      }
    } else if (mapEngine === 'leaflet') {
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
    if (!isNavigating || !autoFollow || !liveLocation || !mapInstance) return;
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
    if (typeof mapInstance.panTo === 'function') {
      mapInstance.panTo(mapEngine === 'leaflet' ? [target.lat, target.lng] : target,
        { animate: true, duration: 0.4 });
    }
  }, [isNavigating, autoFollow, liveLocation?.lat, liveLocation?.lng, liveHeading, speedMps, mapEngine, mapInstance]);

  // Handle user manual interaction to disable continuous auto-centering
  const handleUserMapInteraction = useCallback(() => {
    setAutoFollow(false);
    setIsFollowingCamera(false);
  }, []);

  const toggleAutoFollow = useCallback(() => {
    setAutoFollow((prev) => {
      const next = !prev;
      if (next) {
        handleRecenter();
      }
      return next;
    });
  }, [handleRecenter]);

  const currentStep = activeRoute?.steps?.[currentStepIndex] || activeRoute?.steps?.[0] || null;
  const nextStep = activeRoute?.steps?.[currentStepIndex + 1] || null;

  return {
    activeRoute,
    isRerouting,
    rerouteError,
    hasArrived,
    currentStep,
    nextStep,
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
    retryReroute: () => destinationRef.current && liveLocation && triggerRouteCalculation(liveLocation, destinationRef.current),
  };
}
