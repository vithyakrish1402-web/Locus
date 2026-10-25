// Which map the app is running, and why, for the read-only line in SYS_CONFIG.
// `failReason` is why the Google map was given up on (null while Google is in use):
//   'no-key'       the build has no Maps key, so Google is never tried
//   'timeout'      Google did not load in time (slow or no connection)
//   'key-rejected' Google loaded but refused the key (gm_authFailure)
//   'crashed'      the Google map crashed twice (components/map/MapErrorBoundary.jsx)

/** The status line's wording. */
export const MAP_STATUS_LABEL = {
  google: 'Map: Google',
  backup: 'Map: Backup (OpenStreetMap)',
  free: 'Map: OpenStreetMap (Google on satellite)',
};
export const MAP_STATUS_REASON_TEXT = {
  'no-key': 'No Google Maps key in this build',
  timeout: 'Google map could not load (slow or no connection)',
  'key-rejected': 'Google rejected the map key',
  crashed: 'Google map stopped working',
};

/**
 * `googleInUse` is whether the Google map is the one on screen. The free map is the normal map
 * and Google is only for satellite, so Google being usable but not showing is just 'free'.
 * @returns {{engine: 'google'|'backup'|'free', reason: 'ok'|'no-key'|'timeout'|'key-rejected'|'crashed'}}
 */
export function mapEngineStatus(failReason, googleInUse = true) {
  if (failReason) return { engine: 'backup', reason: failReason };
  return googleInUse ? { engine: 'google', reason: 'ok' } : { engine: 'free', reason: 'ok' };
}
