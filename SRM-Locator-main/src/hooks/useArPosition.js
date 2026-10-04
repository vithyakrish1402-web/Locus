import { useEffect, useRef, useState } from 'react';
import { createPositionFilter } from '../utils/arPosition';

// AR Scan's position, while it is open. App's liveLocation is shared with the squad and
// polled at the SYS_CONFIG rate (up to 15 s old in ECO), and takes every fix however
// vague. AR Scan needs better: it runs its own high-accuracy watch, drops vague fixes and
// filters the rest (createPositionFilter).
//
// Returns { position, accuracy }: `position` the filtered { lat, lng }, or `fallback`
// (App's liveLocation) until a fix has been accepted, or if geolocation is unavailable;
// `accuracy` the latest fix's reported accuracy in metres, accepted or not (null before
// any), for the debug overlay.
export function useArPosition(fallback) {
  const filterRef = useRef(null);
  const [state, setState] = useState({ position: null, accuracy: null });

  useEffect(() => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
    if (!geo || typeof geo.watchPosition !== 'function') return undefined;
    filterRef.current = createPositionFilter();
    const id = geo.watchPosition(
      (fix) => {
        const { latitude, longitude, accuracy } = fix.coords;
        const { accepted, position } = filterRef.current.update({
          lat: latitude,
          lng: longitude,
          accuracy,
          timestamp: fix.timestamp || Date.now(),
        });
        setState((prev) => ({
          position: accepted ? position : prev.position,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
        }));
      },
      (err) => console.warn('[SYS_AR] AR position watch failed, using the shared fix.', err?.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
    return () => geo.clearWatch(id);
  }, []);

  return { position: state.position ?? fallback ?? null, accuracy: state.accuracy };
}
