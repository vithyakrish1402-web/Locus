import { useState, useEffect, useRef, useCallback } from 'react';
import { haversineMeters, findNearestPointOnPath, interpolateHeading } from '../utils/navGeometry';
import { fetchGoogleWalkingRoute, fetchOsrmWalkingRoute } from '../utils/routingProviders';
import { findCampusPedestrianRoute } from '../data/campusPedestrianGraph';
import { generateStepsFromPath } from '../utils/navGeometry';
import { formatDistanceMeters, formatDurationMinutes } from '../utils/walkingRoute';

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
  const [isFollowingCamera, setIsFollowingCamera] = useState(true);
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState(0);
  const [remainingTimeMinutes, setRemainingTimeMinutes] = useState(0);
  const [distanceToNextStepMeters, setDistanceToNextStepMeters] = useState(0);

  // Consecutive off-route counter
  const offRouteCountRef = useRef(0);
  const lastRerouteTimeRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const destinationRef = useRef(destination);
  destinationRef.current = destination;

  // Track map camera animated state
  const lastCameraHeadingRef = useRef(liveHeading || 0);

  // Route calculation function
  const triggerRouteCalculation = useCallback(async (origin, dest) => {
    if (!origin || !dest) return;
    const now = Date.now();
    if (now - lastRerouteTimeRef.current < MIN_REROUTE_INTERVAL_MS && activeRoute) return;
    if (rerouteInFlightRef.current) return;

    rerouteInFlightRef.current = true;
    setIsRerouting(true);
    setRerouteError(null);
    lastRerouteTimeRef.current = now;

    try {
      const fetcher = mapEngine === 'google' ? fetchGoogleWalkingRoute : fetchOsrmWalkingRoute;
      let route = await fetcher(origin, dest);

      // Campus pedestrian graph fallback if public routing fails or returns null
      if (!route || !route.path || route.path.length === 0) {
        const campusPath = findCampusPedestrianRoute(origin, dest);
        if (campusPath && campusPath.length >= 2) {
          const steps = generateStepsFromPath(campusPath, dest.name);
          let meters = 0;
          for (let i = 0; i < campusPath.length - 1; i++) {
            meters += haversineMeters(campusPath[i], campusPath[i + 1]);
          }
          const mins = Math.max(1, Math.round(meters / 1.4 / 60));
          route = {
            path: campusPath,
            steps,
            distance: { text: formatDistanceMeters(meters) },
            duration: { text: formatDurationMinutes(mins) },
            distanceMeters: meters,
            durationSeconds: mins * 60,
            isRealRoute: true,
          };
        }
      }

      // Check if destination is still valid
      if (destinationRef.current?.lat === dest.lat && destinationRef.current?.lng === dest.lng) {
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
      setRerouteError('Routing service unavailable');
    } finally {
      rerouteInFlightRef.current = false;
      setIsRerouting(false);
    }
  }, [mapEngine, activeRoute]);

  // Reset session when navigation starts or destination changes
  useEffect(() => {
    if (!isNavigating || !destination) {
      setActiveRoute(null);
      setIsRerouting(false);
      setRerouteError(null);
      setHasArrived(false);
      setCurrentStepIndex(0);
      setIsFollowingCamera(true);
      offRouteCountRef.current = 0;
      return;
    }

    setHasArrived(false);
    offRouteCountRef.current = 0;
    setCurrentStepIndex(0);
    setIsFollowingCamera(true);

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

  // Camera Follow Controller: Google Maps & Leaflet smooth position & bearing alignment
  useEffect(() => {
    if (!isNavigating || !isFollowingCamera || !liveLocation || !mapInstance) return;

    const targetCenter = { lat: liveLocation.lat, lng: liveLocation.lng };
    const targetZoom = 19; // Navigation perspective zoom

    // Google Maps camera handling
    if (mapEngine === 'google' && typeof mapInstance.moveCamera === 'function') {
      try {
        // Shift center slightly down so heading ahead is visible
        // Bearing: align with direction of travel when moving (> 0.6 m/s)
        const isMoving = (speedMps || 0) > 0.6;
        const targetHeading = isMoving && liveHeading != null ? liveHeading : (mapInstance.getHeading?.() || 0);

        // Smooth heading interpolation
        const currentCamHeading = lastCameraHeadingRef.current || 0;
        const smoothHeading = isMoving ? interpolateHeading(currentCamHeading, targetHeading, 0.25) : currentCamHeading;
        lastCameraHeadingRef.current = smoothHeading;

        mapInstance.moveCamera({
          center: targetCenter,
          zoom: targetZoom,
          heading: smoothHeading,
          tilt: 35, // Google Maps perspective tilt for turn-by-turn feel
        });
      } catch {
        mapInstance.setCenter?.(targetCenter);
      }
    } else if (mapEngine === 'google' && typeof mapInstance.panTo === 'function') {
      mapInstance.panTo(targetCenter);
    } else if (mapEngine === 'leaflet') {
      // Leaflet camera handling: zoom into navigation zoom 19 and follow smoothly
      const currentZoom = mapInstance.getZoom?.() || 17;
      if (currentZoom < targetZoom) {
        mapInstance.flyTo?.([targetCenter.lat, targetCenter.lng], targetZoom, { duration: 0.8 });
      } else if (typeof mapInstance.panTo === 'function') {
        mapInstance.panTo([targetCenter.lat, targetCenter.lng], { animate: true, duration: 0.4 });
      }
    }
  }, [isNavigating, isFollowingCamera, liveLocation?.lat, liveLocation?.lng, liveHeading, speedMps, mapEngine, mapInstance]);

  // Handle user manual interaction to disable camera follow
  const handleUserMapInteraction = useCallback(() => {
    if (isFollowingCamera) {
      setIsFollowingCamera(false);
    }
  }, [isFollowingCamera]);

  // Recenter action
  const handleRecenter = useCallback(() => {
    setIsFollowingCamera(true);
    if (!liveLocation || !mapInstance) return;

    if (mapEngine === 'google') {
      if (typeof mapInstance.moveCamera === 'function') {
        mapInstance.moveCamera({
          center: { lat: liveLocation.lat, lng: liveLocation.lng },
          zoom: 19,
          heading: liveHeading || 0,
          tilt: 45,
        });
      } else {
        mapInstance.panTo({ lat: liveLocation.lat, lng: liveLocation.lng });
      }
    } else if (mapEngine === 'leaflet') {
      mapInstance.flyTo?.([liveLocation.lat, liveLocation.lng], 19, { duration: 0.8 });
    }
  }, [liveLocation, liveHeading, mapEngine, mapInstance]);

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
    isFollowingCamera,
    handleUserMapInteraction,
    handleRecenter,
    retryReroute: () => destinationRef.current && liveLocation && triggerRouteCalculation(liveLocation, destinationRef.current),
  };
}
