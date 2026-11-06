// Whether a map engine's map is still on the page. A map whose engine has been unmounted must
// not be moved: Leaflet's remove() deletes the map's panes but leaves the object looking usable,
// and every move then throws "Cannot read properties of undefined (reading '_leaflet_pos')"
// (the full-screen crash on 2026-10-25). A hidden map (visibility: hidden) is still attached.
// Leaflet maps have getContainer(), Google maps getDiv(); a map with neither counts as attached.
export function isMapAttached(map) {
  if (!map) return false;
  const element = map.getContainer?.() ?? map.getDiv?.();
  return element ? element.isConnected !== false : true;
}
