package com.locus.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Native WiFi scanning for WiFi positioning (WiFi Arc, Stage 4): one method, scan(), that
 * returns the access points visible right now.
 *
 * The scan, freshness and gate logic is ported from the field-survey tool's
 * WifiSurveyPlugin (tools/wifi-survey), where it was verified on a device. That tool is a
 * separate app and shares no code with LOCUS, so this is a copy, not a dependency.
 * Only its scan path came across. This plugin has no UI, requests no permissions, opens
 * no settings screens, writes nothing and caches nothing: every call is a real scan attempt.
 *
 * The guarantee, same as the survey tool: {@code aps} is only returned when Android says
 * the scan completed, and it only contains entries observed after the scan was requested.
 * getScanResults() will happily hand back a previous scan (when throttled, when a scan
 * fails, or before one finishes) and nothing in the list says so apart from each entry's
 * timestamp. For any other outcome {@code aps} is absent, so a caller can't mistake
 * old results for current ones.
 *
 * Throttling: none of our own. Android 9+ allows a foreground app 4 scans per 2 minutes
 * (background apps far fewer). Past that, startScan() returns false, and this reports
 * "throttled" immediately instead of waiting out the timeout. Pacing calls is the
 * caller's job (src/utils/wifiScan.js).
 */
@CapacitorPlugin(
    name = "WifiScan",
    permissions = {
        // Declared so the permission state can be read (and requested through Capacitor's
        // built-in requestPermissions(), if the app ever wants to). scan() itself never prompts.
        @Permission(
            alias = WifiScanPlugin.LOCATION,
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        )
    }
)
public class WifiScanPlugin extends Plugin {

    static final String LOCATION = "location";

    private static final String TAG = "WifiScan";
    private static final int DEFAULT_SCAN_TIMEOUT_MS = 10000;
    private static final int MAX_SCAN_TIMEOUT_MS = 60000;

    private final Handler main = new Handler(Looper.getMainLooper());
    /** The scan in flight, if any. Only touched on the main thread. */
    private PendingScan pending;

    /**
     * Request a fresh scan and wait for it.
     *
     * Resolves with {@code outcome}, which is one of:
     *   fresh     - scan completed; {@code aps} holds only entries seen after the request
     *   empty     - scan completed and found no access points; {@code aps} is []
     *   throttled - startScan() was refused (the OS throttle); nothing new was scanned
     *   stale     - the OS reported the scan failed, so only old cached results exist
     *   timeout   - no usable scan-complete broadcast within {@code timeoutMs}
     * {@code aps} is present only for fresh and empty. Each entry is
     * {bssid, ssid, rssi, frequency}: bssid lowercase, ssid "" when hidden, rssi in dBm,
     * frequency in MHz.
     *
     * Rejects when a scan can't be attempted. The code names the first blocker and
     * {@code data} carries every gate's state (see gates()), so a caller can tell
     * "Location switched off" from "permission denied" even when both are true:
     *   PERMISSION_DENIED  no precise-location grant (data.locationPermission says which)
     *   LOCATION_OFF       the device-wide Location switch is off
     *   WIFI_OFF           WiFi is off and background Wi-Fi scanning is disabled
     *   WIFI_UNAVAILABLE   the device has no WiFi
     *   SCAN_IN_PROGRESS   another scan() hasn't settled yet
     *   CANCELLED          the app was destroyed mid-scan
     */
    @PluginMethod
    public void scan(final PluginCall call) {
        // getInt, not getLong: a JS number arrives as an Integer, and getLong would
        // silently fall back to the default for it.
        int requested = call.getInt("timeoutMs", DEFAULT_SCAN_TIMEOUT_MS);
        final long timeoutMs = Math.max(1000, Math.min(requested, MAX_SCAN_TIMEOUT_MS));
        main.post(() -> beginScan(call, timeoutMs));
    }

    // ------------------------------------------------------------------ gates

    /**
     * Every gate that can block a scan, reported separately. The Location permission and
     * the device-wide Location switch are separate: Android withholds scan results
     * if EITHER one is missing.
     */
    private JSObject gates() {
        WifiManager wifi = wifiManager();
        JSObject result = new JSObject();
        result.put("locationPermission", locationPermission());
        result.put("locationServicesOn", locationServicesOn());
        result.put("wifiOn", wifi != null && wifi.isWifiEnabled());
        result.put("scanAlwaysAvailable", wifi != null && scanAlwaysAvailable(wifi));
        return result;
    }

    /** The first closed gate, or null when a scan can run. */
    private Blocker blocker(WifiManager wifi) {
        if (wifi == null) {
            return new Blocker("This device has no WiFi", "WIFI_UNAVAILABLE");
        }
        if (!isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            return new Blocker("Precise location permission is required to scan", "PERMISSION_DENIED");
        }
        if (!locationServicesOn()) {
            return new Blocker("Location is turned off on this device", "LOCATION_OFF");
        }
        if (!wifi.isWifiEnabled() && !scanAlwaysAvailable(wifi)) {
            return new Blocker("WiFi is off and background Wi-Fi scanning is disabled", "WIFI_OFF");
        }
        return null;
    }

    /**
     * FINE is what counts: LOCUS targets SDK 29+, so startScan() and getScanResults() both
     * require ACCESS_FINE_LOCATION. Android 12+ lets the user grant only approximate
     * location, which leaves COARSE without FINE. That is reported as its own state
     * because it looks like "granted" in the permission dialog.
     *
     * LOCUS's location prompt normally comes from the WebView's geolocation request, not
     * from Capacitor's requestPermissions(). Capacitor only records "don't ask again" for
     * requests it made itself, so after a WebView-originated denial this reads "prompt".
     */
    private String locationPermission() {
        if (isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            return "granted";
        }
        if (isGranted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            return "approximate";
        }
        PermissionState state = getPermissionState(LOCATION);
        return state == null ? PermissionState.PROMPT.toString() : state.toString();
    }

    private boolean locationServicesOn() {
        LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        return lm != null && LocationManagerCompat.isLocationEnabled(lm);
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private WifiManager wifiManager() {
        return (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    }

    /**
     * "Wi-Fi scanning" in Location settings: the radio can scan even with WiFi off.
     * Deprecated alongside startScan() (API 29) and, like it, still functional.
     */
    @SuppressWarnings("deprecation")
    private static boolean scanAlwaysAvailable(WifiManager wifi) {
        return wifi.isScanAlwaysAvailable();
    }

    // ------------------------------------------------------------------ scanning

    private void beginScan(PluginCall call, long timeoutMs) {
        if (pending != null) {
            call.reject("A scan is already in progress", "SCAN_IN_PROGRESS");
            return;
        }
        WifiManager wifi = wifiManager();
        Blocker blocked = blocker(wifi);
        if (blocked != null) {
            call.reject(blocked.message, blocked.code, gates());
            return;
        }

        final PendingScan scan = new PendingScan(call);
        scan.receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                onScanBroadcast(scan, intent);
            }
        };
        scan.timeout = () -> settle(scan, scan.sawOnlyOldResults ? "stale" : "timeout");
        pending = scan;

        // Registered before startScan() so a fast completion can't slip past us.
        // EXPORTED is safe: SCAN_RESULTS_AVAILABLE_ACTION is a protected broadcast that only
        // the system can send. NOT_EXPORTED would work on API 33+ but below that androidx
        // emulates it with a signature permission, and that path isn't needed here.
        ContextCompat.registerReceiver(
            getContext(),
            scan.receiver,
            new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION),
            ContextCompat.RECEIVER_EXPORTED
        );

        // The freshness baseline. ScanResult.timestamp is microseconds on this same clock
        // (elapsedRealtime, which keeps counting through deep sleep), so the two compare directly.
        scan.requestedAtUs = SystemClock.elapsedRealtimeNanos() / 1000L;
        scan.requestedAtMs = System.currentTimeMillis();

        boolean accepted;
        try {
            accepted = startScanCompat(wifi);
        } catch (SecurityException e) {
            settleWithError(scan, "Android refused the scan: " + e.getMessage(), "PERMISSION_DENIED");
            return;
        }
        scan.accepted = accepted;
        if (!accepted) {
            // Android 9+ refuses once the foreground throttle (4 scans / 2 min) is spent.
            // Nothing new is coming, so report now instead of waiting out the timeout.
            settle(scan, "throttled");
            return;
        }
        main.postDelayed(scan.timeout, timeoutMs);
    }

    @SuppressWarnings("deprecation")
    private static boolean startScanCompat(WifiManager wifi) {
        // Deprecated in API 28 with no replacement for foreground apps. It still works,
        // subject to the throttle.
        return wifi.startScan();
    }

    private void onScanBroadcast(PendingScan scan, Intent intent) {
        if (pending != scan) {
            return;
        }
        if (!intent.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false)) {
            // The OS says this scan failed (throttled, device idle, radio error). Only the
            // previous results are available.
            settle(scan, "stale");
            return;
        }
        List<ScanResult> results = readScanResults();
        if (results.isEmpty()) {
            // With Location switched off mid-scan, Android returns an empty list rather than
            // an error. Here that would read as "no WiFi here", which positioning would
            // believe, so re-check the gates before calling the area empty.
            Blocker blocked = blocker(wifiManager());
            if (blocked != null) {
                settleWithError(scan, blocked.message, blocked.code);
            } else {
                settle(scan, "empty", results);
            }
            return;
        }
        if (countSeenSince(results, scan.requestedAtUs) == 0) {
            // A scan finished, but none of it is newer than our request. Another app's
            // earlier scan can complete just after we ask, so keep waiting for ours.
            scan.sawOnlyOldResults = true;
            return;
        }
        // Emit the exact list that was judged fresh, not a second read that could differ.
        settle(scan, "fresh", results);
    }

    private void settle(PendingScan scan, String outcome) {
        settle(scan, outcome, null);
    }

    private void settle(PendingScan scan, String outcome, List<ScanResult> judged) {
        if (!release(scan)) {
            return;
        }
        List<ScanResult> results = judged != null ? judged : readScanResults();
        long nowUs = SystemClock.elapsedRealtimeNanos() / 1000L;

        JSObject out = new JSObject();
        out.put("outcome", outcome);
        out.put("accepted", scan.accepted);
        out.put("requestedAt", scan.requestedAtMs);
        out.put("completedAt", System.currentTimeMillis());
        out.put("durationMs", (nowUs - scan.requestedAtUs) / 1000L);

        if ("fresh".equals(outcome) || "empty".equals(outcome)) {
            JSArray aps = new JSArray();
            int dropped = 0;
            for (ScanResult r : results) {
                if (r.timestamp < scan.requestedAtUs) {
                    // Left in the OS cache from an earlier scan: not seen by this one.
                    dropped++;
                    continue;
                }
                aps.put(toJson(r));
            }
            out.put("aps", aps);
            out.put("staleDropped", dropped);
        } else if (!results.isEmpty()) {
            long newest = Long.MIN_VALUE;
            for (ScanResult r : results) {
                newest = Math.max(newest, r.timestamp);
            }
            // How long before the request the newest thing Android had was seen, so
            // "stale" comes with a number, not just a label.
            out.put("newestResultAgeMs", Math.max(0L, (scan.requestedAtUs - newest) / 1000L));
        }
        scan.call.resolve(out);
    }

    private void settleWithError(PendingScan scan, String message, String code) {
        if (release(scan)) {
            scan.call.reject(message, code, gates());
        }
    }

    /** Detach a scan from the plugin exactly once. Returns false if it was already settled. */
    private boolean release(PendingScan scan) {
        if (pending != scan) {
            return false;
        }
        pending = null;
        if (scan.timeout != null) {
            main.removeCallbacks(scan.timeout);
        }
        try {
            getContext().unregisterReceiver(scan.receiver);
        } catch (IllegalArgumentException ignored) {
            // Already unregistered.
        }
        return true;
    }

    private List<ScanResult> readScanResults() {
        WifiManager wifi = wifiManager();
        try {
            List<ScanResult> results = wifi == null ? null : wifi.getScanResults();
            return results == null ? Collections.emptyList() : results;
        } catch (SecurityException e) {
            Log.w(TAG, "getScanResults refused", e);
            return Collections.emptyList();
        }
    }

    private static int countSeenSince(List<ScanResult> results, long sinceUs) {
        int count = 0;
        for (ScanResult r : results) {
            if (r.timestamp >= sinceUs) {
                count++;
            }
        }
        return count;
    }

    @SuppressWarnings("deprecation")
    private static JSObject toJson(ScanResult r) {
        JSObject ap = new JSObject();
        // Lowercase to match the wifi_aps document IDs.
        ap.put("bssid", r.BSSID == null ? "" : r.BSSID.toLowerCase(Locale.US));
        // ScanResult.SSID is the raw name without WifiInfo-style quotes; "" for hidden networks.
        ap.put("ssid", r.SSID == null ? "" : r.SSID);
        ap.put("rssi", r.level);
        ap.put("frequency", r.frequency);
        return ap;
    }

    @Override
    protected void handleOnDestroy() {
        PendingScan scan = pending;
        if (scan != null) {
            settleWithError(scan, "App closed during the scan", "CANCELLED");
        }
    }

    private static final class Blocker {
        final String message;
        final String code;

        Blocker(String message, String code) {
            this.message = message;
            this.code = code;
        }
    }

    private static final class PendingScan {
        final PluginCall call;
        BroadcastReceiver receiver;
        Runnable timeout;
        long requestedAtUs;
        long requestedAtMs;
        boolean accepted;
        boolean sawOnlyOldResults;

        PendingScan(PluginCall call) {
            this.call = call;
        }
    }
}
