// A theme colour as a literal, for the few places that can't take a CSS variable: the Google
// map's Polyline and Leaflet's path options draw with colours given in JavaScript. Read from
// <html> each time it is asked, so it follows the theme; `fallback` when there is no
// document (tests) or the variable is unset.

export function cssColor(name, fallback) {
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}
