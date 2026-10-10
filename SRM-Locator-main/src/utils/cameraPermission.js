// Whether the camera is already allowed for AR Scan, so its explainer ("Allow the camera for
// AR Scan") shows only until it is (redesign, permission explainers).
//
// Two ways to know: the browser's Permissions API, where it answers for the camera (it may
// not in the Android WebView), and a note this phone keeps once the camera has actually
// started for AR Scan. Either is enough. If the camera is later turned off in the phone's
// settings, AR Scan's own start screen and its camera-off state still cover it.

export const CAMERA_ALLOWED_KEY = 'locus.cameraAllowed';

const storage = () => {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

/** True if this phone has noted that the camera started for AR Scan before. */
export function cameraKnownAllowed() {
  try {
    return storage()?.getItem(CAMERA_ALLOWED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Notes that the camera started for AR Scan. */
export function rememberCameraAllowed() {
  try {
    storage()?.setItem(CAMERA_ALLOWED_KEY, '1');
  } catch {
    // Not saved (private window, blocked storage): the explainer may show again next time.
  }
}

/**
 * Asks the Permissions API, where it answers for the camera. Resolves true only when it says
 * 'granted'; false when it says otherwise, can't tell, or isn't there.
 */
export async function cameraPermissionGranted() {
  try {
    const status = await navigator.permissions?.query?.({ name: 'camera' });
    return status?.state === 'granted';
  } catch {
    return false;
  }
}
