// Real building footprints (traced from OpenStreetMap) render in place of the
// old abstract circle pins — an actual replica of each building's shape
// instead of a marker or a route line drawn across the map. Shared between
// the Google engine (App.jsx, imperative google.maps.Polygon) and the
// Leaflet fallback (TacticalLeafletMap.jsx, react-leaflet <Polygon>) so both
// engines render buildings identically.
export const BUILDING_FOOTPRINT_STYLE = {
  strokeColor: '#ef4444',
  strokeOpacity: 0.85,
  strokeWeight: 2,
  fillColor: '#ef4444',
  fillOpacity: 0.12,
};

export const BUILDING_FOOTPRINT_HIGHLIGHT_STYLE = {
  strokeColor: '#ffffff',
  strokeOpacity: 1,
  strokeWeight: 3,
  fillColor: '#ef4444',
  fillOpacity: 0.35,
};
