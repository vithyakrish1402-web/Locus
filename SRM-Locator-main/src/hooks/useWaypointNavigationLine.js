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
// Both map engines use the same blue dashes with a white outline in either theme.
// The straight-line fallback has wider gaps to distinguish it from a routed path.
export const ROUTE_COLOR = '#1A73E8';
export const ROUTE_CASING_COLOR = '#FFFFFF';
export const ROUTE_WIDTH = 5;
export const ROUTE_CASING_WIDTH = 9;
export const ROUTE_DASH_ARRAY = '12 16';
export const FALLBACK_DASH_ARRAY = '8 24';

const routeDashes = (color, width, isRealRoute) => [{
  icon: {
    path: isRealRoute ? 'M 0,-6 0,6' : 'M 0,-4 0,4',
    strokeColor: color, strokeOpacity: 1, strokeWeight: width, scale: 1,
  },
  offset: '0', repeat: isRealRoute ? '28px' : '32px',
}];

export function useWaypointNavigationLine(map, path, isRealRoute, color = ROUTE_COLOR, casingColor = ROUTE_CASING_COLOR) {
  const linesRef = useRef([]); // the outline, then the blue dashes on top
  const styleRef = useRef(null); // which isRealRoute and colours the current lines were built with

  useEffect(() => {
    const clear = () => {
      linesRef.current.forEach((line) => line.setMap(null));
      linesRef.current = [];
      styleRef.current = null;
    };
    if (!map || !window.google || !path || path.length < 2) {
      clear();
      return;
    }

    const style = `${isRealRoute}|${color}|${casingColor}`; // rebuild if route certainty or an explicit style changes
    if (linesRef.current.length && styleRef.current !== style) clear();

    if (!linesRef.current.length) {
      const { Polyline } = window.google.maps;
      linesRef.current = [
        new Polyline({ path, map, strokeColor: casingColor, strokeOpacity: 0, zIndex: 1, icons: routeDashes(casingColor, ROUTE_CASING_WIDTH, isRealRoute) }),
        new Polyline({ path, map, strokeColor: color, strokeOpacity: 0, zIndex: 2, icons: routeDashes(color, ROUTE_WIDTH, isRealRoute) }),
      ];
      styleRef.current = style;
    } else {
      linesRef.current.forEach((line) => line.setPath(path));
    }
  }, [map, path, isRealRoute, color, casingColor]);

  // True-unmount-only teardown — the effect above already removes the line
  // the moment the path clears via its own guard clause; this only catches
  // the map/component itself going away (e.g. the engine falling back to
  // Leaflet mid-session).
  useEffect(() => {
    return () => {
      linesRef.current.forEach((line) => line.setMap(null));
      linesRef.current = [];
    };
  }, []);
}
