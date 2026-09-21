// Turns a native scan() result into what the screen says. Only a 'fresh' outcome is ever
// loggable; every other outcome is a "nothing was written" state with a reason.

const seconds = (ms) => `${Math.max(1, Math.round(ms / 1000))} s`;

/**
 * @param {object} scan      resolved value of WifiSurvey.scan()
 * @param {number} retryInMs from scanBudget(); 0 when unknown
 * @returns {{kind:'fresh'|'stale'|'timeout'|'empty', loggable:boolean, title:string, detail:string}}
 */
export function describeScan(scan, retryInMs = 0) {
  const retry = retryInMs > 0 ? `Retry in about ${seconds(retryInMs)}.` : 'Wait about 30 s and retry.';
  const age =
    typeof scan.newestResultAgeMs === 'number'
      ? ` The newest result Android had was seen ${seconds(scan.newestResultAgeMs)} before you tapped.`
      : '';

  switch (scan.outcome) {
    case 'fresh': {
      const dropped = scan.staleDropped
        ? ` ${scan.staleDropped} older cached ${scan.staleDropped === 1 ? 'entry was' : 'entries were'} left out.`
        : '';
      return {
        kind: 'fresh',
        loggable: true,
        title: `Fresh scan: ${scan.aps.length} access ${scan.aps.length === 1 ? 'point' : 'points'}`,
        detail: `Every row was seen after you tapped.${dropped}`,
      };
    }
    case 'throttled':
      return {
        kind: 'stale',
        loggable: false,
        title: 'Stale scan. Nothing logged.',
        detail: `Android refused a fresh scan (limit: 4 scans per 2 minutes) and only has old results.${age} ${retry} To remove the limit, turn off Developer options > Wi-Fi scan throttling.`,
      };
    case 'stale':
      return {
        kind: 'stale',
        loggable: false,
        title: 'Stale scan. Nothing logged.',
        detail: `The scan didn't complete, so Android returned cached results from an earlier scan.${age} ${retry}`,
      };
    case 'timeout':
      return {
        kind: 'timeout',
        loggable: false,
        title: 'Scan timed out. Nothing logged.',
        detail: 'No scan results came back within 10 s. Tap LOG POINT to try again.',
      };
    case 'empty':
      return {
        kind: 'empty',
        loggable: false,
        title: 'No access points found. Nothing logged.',
        detail: 'The scan completed but found no WiFi networks here. A point with no rows would lose its GPS fix, so nothing was written.',
      };
    default:
      return {
        kind: 'timeout',
        loggable: false,
        title: 'Unexpected scan result. Nothing logged.',
        detail: `Unknown outcome "${scan.outcome}".`,
      };
  }
}
