// One "glide the map camera to this point" action, shared by the matrix building tap and the
// rally-point notice. Each map engine registers a driver (App.jsx for google-map-react,
// TacticalLeafletMap.jsx for Leaflet); focusMapOn() drives whichever is live.
//
//   driver = {
//     element,                       // the map's container, watched for the user's touch
//     getView() -> {lat, lng, zoom}, // where the camera is now
//     setView({lat, lng, zoom}),     // jump there instantly
//     fly?(target, ms, done) -> cancel  // the engine's own animated move (Leaflet flyTo).
//   })                                 // Without it, the glide is stepped here with rAF.

/** How long the slow glide takes. Increase for slower. */
export const MAP_FOCUS_DURATION_MS = 1800;
/** Zoom when focusing a building (the same zoom a marker tap has always used). */
export const MAP_FOCUS_BUILDING_ZOOM = 19;
/** Zoom when focusing a rally point. */
export const MAP_FOCUS_RALLY_ZOOM = 19;
/** Cubic ease-in-out. */
export const MAP_FOCUS_EASING = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
/** The move used instead of the glide when the device asks for reduced motion. */
export const MAP_FOCUS_REDUCED_MS = 150;

let driver = null;
let cancelGlide = null;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Stops the glide in progress, if any, leaving the camera where it is. */
export function cancelMapFocus() {
  const cancel = cancelGlide;
  cancelGlide = null;
  cancel?.();
}

/**
 * Registers the live engine's driver and returns the function that unregisters it.
 * Touching the map (finger, wheel) cancels any glide so it never fights the user.
 */
export function registerMapDriver(next) {
  cancelMapFocus();
  driver = next;
  const stop = () => cancelMapFocus();
  const events = ['pointerdown', 'touchstart', 'wheel'];
  const el = next.element;
  events.forEach((e) => el?.addEventListener(e, stop, { passive: true }));
  return () => {
    events.forEach((e) => el?.removeEventListener(e, stop));
    if (driver === next) {
      cancelMapFocus();
      driver = null;
    }
  };
}

/**
 * Glides the map to a point, redirecting any glide already running.
 * @returns {boolean} false when nothing was started (no coordinates, or no map yet)
 */
export function focusMapOn({ lat, lng, zoom = MAP_FOCUS_BUILDING_ZOOM } = {}, { onDone } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    if (import.meta.env?.DEV) console.warn('[mapFocus] no coordinates to focus on', { lat, lng });
    return false;
  }
  if (!driver) return false;

  cancelMapFocus();
  const target = { lat, lng, zoom };
  const ms = prefersReducedMotion() ? MAP_FOCUS_REDUCED_MS : MAP_FOCUS_DURATION_MS;
  let live = true;
  const finish = () => {
    if (!live) return;
    live = false;
    cancelGlide = null;
    onDone?.(target);
  };
  const stop = () => { live = false; };

  if (driver.fly) {
    const cancelFly = driver.fly(target, ms, finish);
    cancelGlide = () => { stop(); cancelFly?.(); };
    return true;
  }

  const from = driver.getView();
  const started = performance.now();
  let frame = 0;
  const step = (now) => {
    if (!live) return;
    const t = Math.min(1, Math.max(0, (now - started) / ms));
    const e = MAP_FOCUS_EASING(t);
    driver.setView({
      lat: from.lat + (target.lat - from.lat) * e,
      lng: from.lng + (target.lng - from.lng) * e,
      zoom: from.zoom + (target.zoom - from.zoom) * e,
    });
    if (t < 1) frame = requestAnimationFrame(step);
    else finish();
  };
  frame = requestAnimationFrame(step);
  cancelGlide = () => { stop(); cancelAnimationFrame(frame); };
  return true;
}
