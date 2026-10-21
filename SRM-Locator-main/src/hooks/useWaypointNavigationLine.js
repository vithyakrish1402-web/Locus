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
// Real routes use aligned circular symbols with a casing around each dot.
// The uncertain straight-line fallback stays a sparse, light dash.
// Leaflet mirrors this style in TacticalLeafletMap.jsx.
export const ROUTE_WIDTH = 5;
export const ROUTE_CASING_WIDTH = 9;

const routeDots = (color, diameter) => [{
  icon: {
    path: window.google.maps.SymbolPath.CIRCLE,
    fillColor: color, fillOpacity: 1, strokeOpacity: 0, scale: diameter / 2,
  },
  offset: '0', repeat: '16px',
}];

export function useWaypointNavigationLine(map, path, isRealRoute, color = '#1F4FB8', casingColor = '#FFFFFF') {
  const linesRef = useRef([]); // the casing (real routes only), then the line on top
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

    const style = `${isRealRoute}|${color}|${casingColor}`; // a theme change rebuilds the lines in its colours
    if (linesRef.current.length && styleRef.current !== style) clear();

    if (!linesRef.current.length) {
      const { Polyline } = window.google.maps;
      linesRef.current = isRealRoute
        ? [
          new Polyline({ path, map, strokeColor: casingColor, strokeOpacity: 0, zIndex: 1, icons: routeDots(casingColor, ROUTE_CASING_WIDTH) }),
          new Polyline({ path, map, strokeColor: color, strokeOpacity: 0, zIndex: 2, icons: routeDots(color, ROUTE_WIDTH) }),
        ]
        : [new Polyline({
          path,
          map,
          strokeOpacity: 0, // dashing comes from the repeating icon below, not the base stroke
          icons: [{
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.45, strokeColor: color, scale: 2 },
            offset: '0',
            repeat: '22px', // a sparse dash = "best effort", not a real route
          }],
        })];
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
