import { useState, useCallback, useEffect, useRef } from 'react';

// deviceorientation fires at roughly the sensor rate (~60Hz on Android). Calling
// setHeading on every event re-renders all of App.jsx — which owns the map, every
// marker and every overlay — 60 times a second. That made the map visibly flicker
// and left panning unresponsive, because google-map-react shallow-compares its
// `options` prop and re-applied the whole style array on each of those renders.
//
// A compass only needs to *look* smooth, so updates are gated two ways: at most
// one state update per MIN_INTERVAL_MS, and only when the bearing actually moved
// MIN_DELTA_DEG. A phone held still therefore triggers no re-renders at all,
// instead of 60 a second.
const MIN_INTERVAL_MS = 100; // <= 10 state updates/sec
const MIN_DELTA_DEG = 1.5;   // ignore sensor jitter below this

// Shortest angular distance between two bearings, accounting for the 360->0 wrap
// (so 359deg -> 1deg reads as 2deg of movement, not 358).
const angularDelta = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

// Extracted from ARCompass.jsx so the AR compass and the live map marker
// (LiveLocationMarker) both read from the same compass value instead of each
// running their own DeviceOrientation listener.
export function useDeviceHeading() {
  const [heading, setHeading] = useState(0);
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  // Always holds the newest raw bearing, untouched by the throttle above, so
  // telemetry emits report the true current heading rather than whatever value
  // last made it past the render gate.
  const headingRef = useRef(0);
  const lastEmitAtRef = useRef(0);
  const lastEmitValRef = useRef(null);

  // useCallback with empty deps keeps this function's identity stable across
  // renders (setHeading is guaranteed stable by React) so addEventListener/
  // removeEventListener always operate on the same reference — otherwise
  // removeEventListener silently no-ops against a stale closure from an
  // earlier render and the listener leaks past unmount.
  const handleOrientation = useCallback((event) => {
    let next = null;
    if (typeof event.webkitCompassHeading === 'number') {
      // iOS absolute (0 is a valid heading — due north — so this must not be a truthy check)
      next = event.webkitCompassHeading;
    } else if (event.absolute && event.alpha !== null) {
      // Android absolute
      next = 360 - event.alpha;
    }
    // If it's a relative event (event.absolute is false), ignore it.
    // Otherwise it overwrites the absolute heading with 0!
    if (next === null || Number.isNaN(next)) return;

    headingRef.current = next;

    const now = Date.now();
    if (now - lastEmitAtRef.current < MIN_INTERVAL_MS) return;
    if (lastEmitValRef.current !== null && angularDelta(next, lastEmitValRef.current) < MIN_DELTA_DEG) return;

    lastEmitAtRef.current = now;
    lastEmitValRef.current = next;
    setHeading(next);
  }, []);

  // iOS 13+ requires this to run inside a user gesture (a click handler),
  // so callers on iOS must invoke it from one (e.g. ARCompass's "GRANT_ACCESS"
  // button). On Android there's no such gate — safe to call on mount.
  const requestHeadingPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        if (permissionState === 'granted') {
          window.addEventListener('deviceorientationabsolute', handleOrientation, true);
          window.addEventListener('deviceorientation', handleOrientation, true);
          setPermissionsGranted(true);
          return true;
        }
        return false;
      } catch (err) {
        console.error(err);
        return false;
      }
    } else {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
      window.addEventListener('deviceorientation', handleOrientation, true);
      setPermissionsGranted(true);
      return true;
    }
  }, [handleOrientation]);

  useEffect(() => {
    return () => {
      window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
      window.removeEventListener('deviceorientation', handleOrientation, true);
    };
  }, [handleOrientation]);

  return { heading, headingRef, permissionsGranted, requestHeadingPermission };
}
