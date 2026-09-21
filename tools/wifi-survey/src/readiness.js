// Why LOG POINT can't run right now, one entry per independent cause. Permission and
// the device Location switch are separate gates on Android: an app can hold location
// permission and still get zero WiFi scan results because Location is off. So each
// gets its own card and its own fix, never one generic "location error".

/**
 * @param {object} status resolved value of WifiSurvey.getStatus()
 * @returns {{code:string, title:string, detail:string, actions:string[]}[]}
 */
export function blockersFromStatus(status) {
  const blockers = [];

  switch (status.locationPermission) {
    case 'granted':
      break;
    case 'approximate':
      blockers.push({
        code: 'PRECISE_LOCATION_OFF',
        title: 'Precise location is off for this app',
        detail:
          'You granted approximate location only. Android shows WiFi scan results only to apps with precise location.',
        actions: ['request', 'appSettings'],
      });
      break;
    case 'denied':
      blockers.push({
        code: 'PERMISSION_DENIED',
        title: 'Location permission denied',
        detail:
          "This app can't get a GPS fix or read WiFi scan results without location permission, and Android won't ask again. Go to App settings > Permissions > Location, choose Allow, and turn on Use precise location.",
        actions: ['appSettings'],
      });
      break;
    case 'prompt-with-rationale':
      blockers.push({
        code: 'PERMISSION_NEEDED',
        title: 'Location permission needed',
        detail:
          'You denied location permission last time. Without it, Android hides every WiFi scan result from this app and GPS is unavailable.',
        actions: ['request', 'appSettings'],
      });
      break;
    default:
      blockers.push({
        code: 'PERMISSION_NEEDED',
        title: 'Location permission needed',
        detail: 'Needed for the GPS fix. Android also shows WiFi scan results only to apps with precise location permission.',
        actions: ['request'],
      });
  }

  if (!status.locationServicesOn) {
    blockers.push({
      code: 'LOCATION_OFF',
      title: 'Location is turned off on this phone',
      detail:
        "The phone's Location switch is off. This is separate from the app's permission: while Location is off, Android blocks GPS and all WiFi scan results for every app.",
      actions: ['locationSettings'],
    });
  }

  if (!status.wifiOn && !status.scanAlwaysAvailable) {
    blockers.push({
      code: 'WIFI_OFF',
      title: 'WiFi is off',
      detail:
        "WiFi is off and background Wi-Fi scanning is disabled, so the radio can't scan. Turn WiFi on. You don't need to connect to a network.",
      actions: ['wifiSettings'],
    });
  }

  return blockers;
}
