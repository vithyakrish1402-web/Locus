import { useState, useCallback, useEffect } from 'react';

// Extracted from ARCompass.jsx so the AR compass and the live map marker
// (LocationMarker) both read from the same compass value instead of each
// running their own DeviceOrientation listener.
export function useDeviceHeading() {
  const [heading, setHeading] = useState(0);
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  // useCallback with empty deps keeps this function's identity stable across
  // renders (setHeading is guaranteed stable by React) so addEventListener/
  // removeEventListener always operate on the same reference — otherwise
  // removeEventListener silently no-ops against a stale closure from an
  // earlier render and the listener leaks past unmount.
  const handleOrientation = useCallback((event) => {
    if (typeof event.webkitCompassHeading === 'number') {
      // iOS absolute (0 is a valid heading — due north — so this must not be a truthy check)
      setHeading(event.webkitCompassHeading);
    } else if (event.absolute && event.alpha !== null) {
      // Android absolute
      setHeading(360 - event.alpha);
    }
    // If it's a relative event (event.absolute is false), ignore it.
    // Otherwise it overwrites the absolute heading with 0!
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

  return { heading, permissionsGranted, requestHeadingPermission };
}
