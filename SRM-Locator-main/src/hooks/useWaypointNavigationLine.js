import { useEffect, useRef } from 'react';

// Draws a live dashed line from the operative's position to the active squad
// waypoint directly on the native Google Maps instance — google-map-react's
// HTML overlays only ever position single lat/lng points, so an actual route
// line needs the imperative google.maps.Polyline API (same reasoning as
// useGhostProjectionLines.js). Unlike the ghost lines, this one instance is
// kept and moved via .setPath() rather than recreated on every position tick,
// since this can fire on every GPS update rather than once a second.
//
// Leaflet-fallback rendering is separate — TacticalLeafletMap.jsx renders the
// same line declaratively via react-leaflet's <Polyline>.
export function useWaypointNavigationLine(map, liveLocation, activeWaypoint, color = '#EF4444') {
  const lineRef = useRef(null);

  useEffect(() => {
    if (!map || !window.google || !liveLocation || !activeWaypoint) {
      if (lineRef.current) {
        lineRef.current.setMap(null);
        lineRef.current = null;
      }
      return;
    }

    const path = [
      { lat: liveLocation.lat, lng: liveLocation.lng },
      { lat: activeWaypoint.lat, lng: activeWaypoint.lng },
    ];

    if (!lineRef.current) {
      lineRef.current = new window.google.maps.Polyline({
        path,
        map,
        strokeOpacity: 0, // dashing comes from the repeating icon below, not the base stroke
        icons: [{
          icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: color, scale: 3 },
          offset: '0',
          repeat: '14px',
        }],
      });
    } else {
      lineRef.current.setPath(path);
    }
  }, [map, liveLocation, activeWaypoint, color]);

  // True-unmount-only teardown — the effect above already removes the line
  // the moment activeWaypoint clears via its own guard clause; this only
  // catches the map/component itself going away (e.g. the engine falling
  // back to Leaflet mid-session).
  useEffect(() => {
    return () => {
      if (lineRef.current) {
        lineRef.current.setMap(null);
        lineRef.current = null;
      }
    };
  }, []);
}
