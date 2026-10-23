import { useEffect, useRef } from 'react';

// Draws the live walking route to the active squad waypoint directly on the
// native Google Maps instance — google-map-react's HTML overlays only ever
// position single lat/lng points, so an actual route line needs the
// imperative google.maps.Polyline API. The instance is kept and moved via .setPath()
// rather than recreated on every position tick, since `path` can change on
// every GPS update while the operative is on the real-route fallback
// (which redraws fresh every render — see useWalkingRoute.js).
//
// Both map engines use the same solid blue route with a white outline in either theme.
export const ROUTE_COLOR = '#1A73E8';
export const ROUTE_CASING_COLOR = '#FFFFFF';
export const ROUTE_WIDTH = 5;
export const ROUTE_CASING_WIDTH = 9;

export function useWaypointNavigationLine(map, path, isRealRoute, color = ROUTE_COLOR, casingColor = ROUTE_CASING_COLOR) {
  const linesRef = useRef([]); // the outline, then the blue route on top
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
        new Polyline({ path, map, strokeColor: casingColor, strokeOpacity: 1, strokeWeight: ROUTE_CASING_WIDTH, zIndex: 1 }),
        new Polyline({ path, map, strokeColor: color, strokeOpacity: 1, strokeWeight: ROUTE_WIDTH, zIndex: 2 }),
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
