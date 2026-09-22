// Thin JS bridge to the locally-defined WifiScan native plugin
// (android/app/src/main/java/com/locus/app/WifiScanPlugin.java), plus the OS scan
// budget that callers pace themselves against. The plugin adds no throttling of its own.
//
// One method:
//
//   const result = await WifiScan.scan({ timeoutMs: 10000 }); // timeoutMs optional, 1-60 s
//
// Resolves with { outcome, accepted, requestedAt, completedAt, durationMs, ... }:
//   'fresh'     aps: [{ bssid, ssid, rssi, frequency }] - only entries seen after the request.
//               bssid is lowercase (the wifi_aps document ID), ssid '' when hidden,
//               rssi in dBm, frequency in MHz. staleDropped counts cache leftovers left out.
//   'empty'     aps: [] - the scan completed and nothing is in range
//   'throttled' Android refused to start a scan (see SCAN_LIMIT below); no aps
//   'stale'     the scan failed and only older cached results exist; no aps
//   'timeout'   no scan completed in time; no aps
// `aps` is present exactly when the list is genuinely current, so `if (result.aps)` is
// the whole freshness check. For the non-fresh outcomes, newestResultAgeMs (when present)
// says how old the newest cached result was at request time.
//
// Rejects, with err.code naming the first blocker and err.data holding every gate
// ({ locationPermission, locationServicesOn, wifiOn, scanAlwaysAvailable }):
//   PERMISSION_DENIED  no precise location. data.locationPermission is 'approximate'
//                      (Android 12+ "approximate" grant), 'denied', 'prompt-with-rationale'
//                      or 'prompt'. A denial that came from the WebView's own geolocation
//                      prompt still reads 'prompt', because Capacitor only remembers
//                      requests it made itself.
//   LOCATION_OFF       the phone's Location switch is off (a separate gate from permission)
//   WIFI_OFF           WiFi off and background Wi-Fi scanning disabled
//   WIFI_UNAVAILABLE   no WiFi hardware
//   SCAN_IN_PROGRESS   a previous scan() hasn't settled
//   CANCELLED          the app closed mid-scan
//   UNAVAILABLE        not running in the Android app (browser, tests)

import { registerPlugin, Capacitor } from '@capacitor/core';

export const WifiScan = registerPlugin('WifiScan', {
  // Browser fallback. Rejecting, not resolving 'empty': "no WiFi here" is a real answer
  // positioning would act on, and the dev server has no way to know it.
  web: {
    scan: () =>
      Promise.reject(
        Object.assign(new Error('WiFi scanning is only available in the Android app'), { code: 'UNAVAILABLE' })
      ),
  },
});

/** True only inside the native Android shell, where the plugin exists at all. */
export function isWifiScanAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// Carried over from the survey tool (tools/wifi-survey/src/scanBudget.js). Android 9+ lets
// a foreground app start 4 WiFi scans per rolling 2 minutes. Past that, startScan() is
// refused and scan() resolves 'throttled'. This only *reports* the budget, so a caller
// can space its scans. Like the survey tool, nothing here adds a cooldown of its own.
export const SCAN_LIMIT = 4;
export const SCAN_WINDOW_MS = 120_000;

/**
 * @param {number[]} acceptedAt epoch-ms times of scans the OS accepted this session
 *   (result.requestedAt where result.accepted is true)
 * @param {number} now          epoch ms
 * @returns {{used:number, limit:number, retryInMs:number}} retryInMs is 0 when a scan
 *   should be allowed now (as far as this session knows - scans from before an app
 *   restart are invisible to it, so a throttle can still happen with retryInMs 0).
 */
export function scanBudget(acceptedAt, now) {
  const recent = acceptedAt.filter((t) => now - t < SCAN_WINDOW_MS).sort((a, b) => a - b);
  const retryInMs =
    recent.length >= SCAN_LIMIT ? Math.max(0, recent[recent.length - SCAN_LIMIT] + SCAN_WINDOW_MS - now) : 0;
  return { used: recent.length, limit: SCAN_LIMIT, retryInMs };
}
