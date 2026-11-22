// The Google map's light and dark styles (redesign Map batch, piece 4), from the handoff's map
// colours (src/theme/tokens.css, --color-map-*). Google's style arrays take literal colours,
// not CSS variables, so the two sets are written out here.
//
// UNTESTED on a real Google map: this PC's browser pane can't be checked against Google's own
// rendering, and the style array syntax only shows its result on a live map. Best effort,
// to check on a phone (owner, 2026-10-05).
//
// Business and transit pins are turned down so the group, the buildings and the meeting point
// stand out; places' names, roads and the campus's own outlines stay.

const shared = [
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

// Place names (the campus's buildings are Google's points of interest) in the theme's full text
// colour on a halo of the map's casing colour, so they read over every part of the map; roads and
// the rest keep the quieter secondary colour. Contrast of the fill, worst case over any map colour
// below: dark 12.4:1 (over roads, #262C35), light 13.2:1 (over water, #CFE0EE). Their casing is
// Google's own data, which no style can change.
export const MAP_LABEL_FILL = { light: '#14181F', dark: '#EEF1F5' }; // --color-text
export const MAP_LABEL_HALO = { light: '#FFFFFF', dark: '#0E1116' }; // --color-map-casing
export const MAP_LABEL_HALO_WIDTH_PX = 3;

const placeLabels = (theme) => [
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: MAP_LABEL_FILL[theme] }] },
  { featureType: 'poi', elementType: 'labels.text.stroke', stylers: [{ color: MAP_LABEL_HALO[theme] }, { weight: MAP_LABEL_HALO_WIDTH_PX }] },
];

export const LIGHT_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#EEF0EC' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#566070' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#D6E8D2' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#DDE1E6' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#CFE0EE' }] },
  ...placeLabels('light'),
  ...shared,
];

export const DARK_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#171B21' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#A3ACB9' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0E1116' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#18241C' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#262C35' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#20252D' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#142230' }] },
  ...placeLabels('dark'),
  ...shared,
];

/** The Google style for the app's theme ('light' | 'dark'). */
export const mapStylesFor = (theme) => (theme === 'dark' ? DARK_MAP_STYLES : LIGHT_MAP_STYLES);
