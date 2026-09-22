// Device check for WiFi Arc Stage 5. It proves the app's first Firestore read works on a
// real phone: auth timing on a cold start, the wifi_aps security rules, and the
// server-only read inside the Android WebView. It is not part of the app.
//
// Only a `vite build --mode device-check` build contains this file. main.jsx imports it
// behind `import.meta.env.MODE === 'device-check'`, which Vite replaces with a constant,
// so every other build (npm run build, both release scripts) compiles the branch and the
// import out entirely. `npm run device-check:wifi` runs it end to end and reads the report
// back over adb logcat (scripts/device-check-wifi.mjs).
//
// It runs once at cold start, as early as JS allows, because that is where the auth race
// is: Firebase restores the saved session asynchronously, so currentUser is still null
// when the read is requested, and the module's own authStateReady() wait is what's under
// test. window.__locusWifiCheck.run() repeats it from DevTools (chrome://inspect).

import { Capacitor } from '@capacitor/core';
import { auth } from '../firebase.js';
import { COLLECTION, estimateWifiPosition, loadAccessPoints, refreshAccessPoints } from '../utils/wifiPositioning.js';
import { WifiScan, isWifiScanAvailable } from '../utils/wifiScan.js';

/** Prefixes the one console line the adb script looks for. */
export const REPORT_MARKER = '[LOCUS_WIFI_CHECK]';

// What the seeded collection held when this check was written (tools/wifi-aps-seed dry
// run of the 2026-09-22 survey export). A re-seed that changes these fails the check on
// purpose: update them alongside the seed.
const EXPECTED = { count: 197, ambiguousFloor: 11 };

const errorInfo = (e) => ({ code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 200) });

function summarize(table) {
  const byBuildingFloor = {};
  let ambiguousFloor = 0;
  for (const ap of table.values()) {
    const key = `${ap.building ?? 'outdoors'}/${ap.floor ?? '-'}`;
    byBuildingFloor[key] = (byBuildingFloor[key] ?? 0) + 1;
    if (ap.ambiguousFloor) ambiguousFloor++;
  }
  return { count: table.size, ambiguousFloor, byBuildingFloor };
}

/** Times a promise-returning step; never throws, errors land in the result. */
async function step(fn) {
  const t = performance.now();
  try {
    const value = await fn();
    return { ok: true, ms: Math.round(performance.now() - t), value };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t), error: errorInfo(e) };
  }
}

/**
 * Runs every check and logs one `[LOCUS_WIFI_CHECK] {json}` line. Only the read path
 * decides the verdict. The scan and estimate are reported, but a no-match (anywhere
 * outside the surveyed TECH PARK floors) or a throttled scan is not a failure of the
 * thing under test.
 */
export async function runWifiDeviceCheck(trigger) {
  const report = {
    trigger,
    msSincePageLoad: Math.round(performance.now()),
    platform: Capacitor.getPlatform(),
    collection: COLLECTION,
  };

  // 1. The first read, requested before anything has waited for auth.
  const signedInAtRequest = Boolean(auth.currentUser);
  const t0 = performance.now();
  const authReady = auth.authStateReady().then(() => Math.round(performance.now() - t0));
  const first = await step(() => loadAccessPoints());
  report.auth = {
    signedInAtRequest,
    sessionRestoredAfterMs: await authReady,
    signedIn: Boolean(auth.currentUser),
    uid: auth.currentUser ? `${auth.currentUser.uid.slice(0, 6)}...` : null,
  };
  report.firstRead = first.ok ? { ok: true, ms: first.ms, ...summarize(first.value) } : first;

  // 2. A second call must come from memory: the same table object, no new read.
  const cached = await step(() => loadAccessPoints());
  report.cachedRead = { ok: cached.ok, ms: cached.ms, sameTable: cached.ok && first.ok && cached.value === first.value };

  // 3. A forced refresh must go back to the server and replace the table.
  const refreshed = await step(() => refreshAccessPoints());
  report.refresh = refreshed.ok
    ? { ok: true, ms: refreshed.ms, count: refreshed.value.size, newTable: refreshed.value !== first.value }
    : refreshed;

  // 4. The rest of the pipeline, on whatever is in range right now.
  if (isWifiScanAvailable()) {
    const scan = await step(() => WifiScan.scan({ timeoutMs: 10000 }));
    report.scan = scan.ok ? { ok: true, ms: scan.ms, outcome: scan.value.outcome, apCount: scan.value.aps?.length ?? 0 } : scan;
    if (scan.ok && scan.value.aps) {
      const estimate = await step(() => estimateWifiPosition([scan.value]));
      report.estimate = estimate.ok ? estimate.value : estimate;
    }
  } else {
    report.scan = { ok: false, error: { code: 'UNAVAILABLE', message: 'not the Android app' } };
  }

  const checks = {
    signedIn: report.auth.signedIn,
    firstReadOk: first.ok,
    count: first.ok && report.firstRead.count === EXPECTED.count,
    ambiguousFloor: first.ok && report.firstRead.ambiguousFloor === EXPECTED.ambiguousFloor,
    cachedFromMemory: report.cachedRead.sameTable,
    refreshReread: refreshed.ok && report.refresh.newTable && report.refresh.count === EXPECTED.count,
  };
  report.expected = EXPECTED;
  report.checks = checks;
  report.verdict = Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL';

  console.info(`${REPORT_MARKER} ${JSON.stringify(report)}`);
  return report;
}

/** Called once from main.jsx in a device-check build. */
export function installWifiDeviceCheck() {
  const api = {
    lastReport: null,
    run: async (trigger = 'manual') => (api.lastReport = await runWifiDeviceCheck(trigger)),
  };
  window.__locusWifiCheck = api;
  return api.run('cold-start');
}
