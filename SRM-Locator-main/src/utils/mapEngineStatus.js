// Which map the app is running, and why, for the read-only line in SYS_CONFIG.
// `failReason` is why the Google map was given up on (null while Google is in use):
//   'no-key'       the build has no Maps key, so Google is never tried
//   'timeout'      Google did not load in time (slow or no connection)
//   'key-rejected' Google loaded but refused the key (gm_authFailure)

/** The status line's wording. */
export const MAP_STATUS_LABEL = {
  google: 'Map: Google',
  backup: 'Map: Backup (OpenStreetMap)',
};
export const MAP_STATUS_REASON_TEXT = {
  'no-key': 'No Google Maps key in this build',
  timeout: 'Google map could not load (slow or no connection)',
  'key-rejected': 'Google rejected the map key',
};

/** @returns {{engine: 'google'|'backup', reason: 'ok'|'no-key'|'timeout'|'key-rejected'}} */
export function mapEngineStatus(failReason) {
  return failReason ? { engine: 'backup', reason: failReason } : { engine: 'google', reason: 'ok' };
}
