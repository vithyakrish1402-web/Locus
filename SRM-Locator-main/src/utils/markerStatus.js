// Shared between App.jsx (google-map-react) and TacticalLeafletMap.jsx
// (Leaflet fallback) so both map engines derive LocationMarker's `status`
// prop the same way instead of duplicating the threshold logic.

// Squad members' `speed` travels over the wire in km/h (see App.jsx's
// update-location emits); this is the spec's 0.5 m/s "moving" cutoff
// converted to m/s so every caller can compare in the same unit.
export const MOVING_SPEED_THRESHOLD_MS = 0.5;

export const deriveMarkerStatus = (speedMs) =>
  speedMs > MOVING_SPEED_THRESHOLD_MS ? 'moving' : 'stationary';
