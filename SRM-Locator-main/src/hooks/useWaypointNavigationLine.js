import { useEffect, useRef } from 'react';

// Draws the live walking route to the active squad waypoint directly on the
// native Google Maps instance — google-map-react's HTML overlays only ever
// position single lat/lng points, so an actual route line needs the
// imperative google.maps.Polyline API (same reasoning as
// useGhostProjectionLines.js). The instance is kept and moved via .setPath()
// rather than recreated on every position tick, since `path` can change on
// every GPS update while the operative is on the real-route fallback
// (which redraws fresh every render — see useWalkingRoute.js).
//
// `isRealRoute` distinguishes a real routed path from the straight-line
// "best effort" fallback: a sparser, lighter dash reads as less certain than
// the normal route styling, per the fallback-behavior spec. Recreates the
// Polyline (rather than just re-pathing it) whenever this flips, since the
// dash pattern lives in the `icons` config, not something .setPath() touches.
//
// Leaflet-fallback rendering is separate — TacticalLeafletMap.jsx renders the
// same path declaratively via react-leaflet's <Polyline>.
export function useWaypointNavigationLine(map, path, isRealRoute, color = '#EF4444') {
  const lineRef = useRef(null);
  const styleRef = useRef(null); // which isRealRoute value the current instance was built with

  useEffect(() => {
    if (!map || !window.google || !path || path.length < 2) {
      if (lineRef.current) {
        lineRef.current.setMap(null);
        lineRef.current = null;
        styleRef.current = null;
      }
      return;
    }

    if (lineRef.current && styleRef.current !== isRealRoute) {
      lineRef.current.setMap(null);
      lineRef.current = null;
    }

    if (!lineRef.current) {
      lineRef.current = new window.google.maps.Polyline({
        path,
        map,
        strokeOpacity: 0, // dashing comes from the repeating icon below, not the base stroke
        icons: [{
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: isRealRoute ? 0.8 : 0.45,
            strokeColor: color,
            scale: isRealRoute ? 3 : 2,
          },
          offset: '0',
          repeat: isRealRoute ? '14px' : '22px', // sparser dash = "best effort", not a real route
        }],
      });
      styleRef.current = isRealRoute;
    } else {
      lineRef.current.setPath(path);
    }
  }, [map, path, isRealRoute, color]);

  // True-unmount-only teardown — the effect above already removes the line
  // the moment the path clears via its own guard clause; this only catches
  // the map/component itself going away (e.g. the engine falling back to
  // Leaflet mid-session).
  useEffect(() => {
    return () => {
      if (lineRef.current) {
        lineRef.current.setMap(null);
        lineRef.current = null;
      }
    };
  }, []);
}
