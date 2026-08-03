import { useEffect } from 'react';
import { getProjectionSegments } from '../utils/ghostProjection';

// Draws each dark member's dead-reckoning projection as a faint, tapering
// dashed line directly on the native Google Maps instance. This needs a real
// polyline between two geo-coordinates, which a google-map-react HTML
// overlay (only ever positions a single lat/lng point) can't express — so
// this mirrors App.jsx's existing building-footprint-polygon effect:
// imperative google.maps.* calls against the map instance, outside the JSX
// tree entirely, torn down and rebuilt whenever the ghost set changes.
//
// Leaflet-fallback rendering is separate — TacticalLeafletMap.jsx renders
// the same segments declaratively via react-leaflet's <Polyline>.
export function useGhostProjectionLines(map, ghostMembers, color = '#A1A1AA') {
  useEffect(() => {
    if (!map || !window.google) return;
    const maps = window.google.maps;
    const polylines = [];

    ghostMembers.forEach((ghost) => {
      if (ghost.phase === 'expired') return;
      const segments = getProjectionSegments(ghost.lastKnownLocation, ghost.position);
      segments.forEach((segment) => {
        polylines.push(new maps.Polyline({
          path: [segment.from, segment.to],
          strokeOpacity: 0, // dashing comes from the repeating icon below, not the base stroke
          map,
          icons: [{
            icon: { path: 'M 0,-1 0,1', strokeOpacity: segment.opacity, strokeColor: color, scale: 2 },
            offset: '0',
            repeat: '8px',
          }],
        }));
      });
    });

    return () => polylines.forEach((p) => p.setMap(null));
  }, [map, ghostMembers, color]);
}
