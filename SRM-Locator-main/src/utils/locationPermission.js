// Whether location is already allowed for LOCUS, so its explainer ("Allow location") shows
// only until it is (redesign Map batch, piece 8). The same two ways to know as the camera's
// (utils/cameraPermission.js): the Permissions API where it answers, and a note this phone
// keeps once a real fix has arrived. Either is enough.

export const LOCATION_ALLOWED_KEY = 'locus.locationAllowed';

const storage = () => {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

/** True if this phone has noted a real location fix before. */
export function locationKnownAllowed() {
  try {
    return storage()?.getItem(LOCATION_ALLOWED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Notes that a real fix arrived. */
export function rememberLocationAllowed() {
  try {
    storage()?.setItem(LOCATION_ALLOWED_KEY, '1');
  } catch {
    // Not saved (private window, blocked storage): the explainer may show again next time.
  }
}

/** Asks the Permissions API; true only when it says 'granted'. */
export async function locationPermissionGranted() {
  try {
    const status = await navigator.permissions?.query?.({ name: 'geolocation' });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}
