package com.locus.wifisurvey;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.Uri;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.location.LocationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native half of the WiFi survey tool: fresh WiFi scans, and the CSV log on disk.
 *
 * Built the same way as LOCUS's LocusUpdaterPlugin (a local @CapacitorPlugin registered by
 * hand in MainActivity, with a FileProvider to hand a file to another app), but it belongs
 * to a separate app in a separate Gradle project and shares no code with LOCUS.
 *
 * What this class guarantees: scan() only returns access points to JS as loggable when
 * Android says the scan completed AND each AP was observed after the scan was requested.
 * getScanResults() will happily hand back a previous scan (when throttled at 4 scans per 2
 * minutes on Android 9+, when a scan fails, or before a scan finishes), and nothing in the
 * result list says so apart from each entry's timestamp. For any outcome other than
 * "fresh", no APs are returned at all, so a JS bug can't log stale data as current.
 */
@CapacitorPlugin(
    name = "WifiSurvey",
    permissions = {
        @Permission(
            alias = WifiSurveyPlugin.LOCATION,
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        )
    }
)
public class WifiSurveyPlugin extends Plugin {

    static final String LOCATION = "location";

    private static final String TAG = "WifiSurvey";
    private static final String LOG_FILE_NAME = "wifi_survey.csv";
    private static final String SHARE_DIR = "share";
    private static final int DEFAULT_SCAN_TIMEOUT_MS = 10000;
    private static final int MAX_SCAN_TIMEOUT_MS = 60000;
    private static final long SHARE_SNAPSHOT_MAX_AGE_MS = 24L * 60 * 60 * 1000;

    private final Handler main = new Handler(Looper.getMainLooper());
    /** Serialises every log-file read and write, so an append never interleaves with a read. */
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    /** The scan in flight, if any. Only touched on the main thread. */
    private PendingScan pending;

    // ------------------------------------------------------------------ status & permission

    /**
     * Each gate that can block a scan, reported separately. The Location permission and
     * the device-wide Location switch are separate: Android withholds scan results
     * if EITHER one is missing.
     */
    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestLocationPermission(PluginCall call) {
        if (isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias(LOCATION, call, "onLocationPermissionResult");
    }

    @PermissionCallback
    private void onLocationPermissionResult(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        startSettings(call, new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getContext().getPackageName())
        ));
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        startSettings(call, new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS));
    }

    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        // Android 10+ can't toggle WiFi programmatically; the panel is the one-tap alternative.
        startSettings(call, new Intent(
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS
        ));
    }

    private JSObject status() {
        WifiManager wifi = wifiManager();
        JSObject result = new JSObject();
        result.put("locationPermission", locationPermission());
        result.put("locationServicesOn", locationServicesOn());
        result.put("wifiOn", wifi != null && wifi.isWifiEnabled());
        result.put("scanAlwaysAvailable", wifi != null && scanAlwaysAvailable(wifi));
        Boolean throttle = scanThrottleEnabled();
        if (throttle != null) {
            result.put("scanThrottle", throttle.booleanValue());
        }
        result.put("sdkInt", Build.VERSION.SDK_INT);
        return result;
    }

    /**
     * Developer options > "Wi-Fi scan throttling" (Android 10+): the 4-scans-per-2-minutes
     * limit. Unset means on, which is the platform default. Returns null if this Android
     * build won't let a normal app read the setting, so JS falls back to "limit applies".
     */
    private Boolean scanThrottleEnabled() {
        try {
            return Settings.Global.getInt(getContext().getContentResolver(), "wifi_scan_throttle_enabled", 1) != 0;
        } catch (SecurityException e) {
            return null;
        }
    }

    /**
     * FINE is what counts: this app targets SDK 29+, so startScan() and getScanResults()
     * both require ACCESS_FINE_LOCATION. Android 12+ lets the user grant only approximate
     * location, which leaves COARSE without FINE. That is reported as its own state
     * because it looks like "granted" in the permission dialog.
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

    private void startSettings(PluginCall call, Intent intent) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        try {
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage(), "SETTINGS_UNAVAILABLE", e);
        }
    }

    // ------------------------------------------------------------------ scanning

    /**
     * Request a fresh scan and wait for it.
     *
     * Resolves with {@code outcome}, which is one of:
     *   fresh     - scan completed; {@code aps} holds only entries seen after the request
     *   throttled - startScan() was refused (the OS throttle); nothing new was scanned
     *   stale     - the OS reported the scan failed, so only old cached results exist
     *   timeout   - no usable scan-complete broadcast within {@code timeoutMs}
     *   empty     - scan completed and found no access points at all
     * For every outcome but "fresh", {@code aps} is omitted on purpose.
     *
     * Rejects (codes PERMISSION_DENIED / LOCATION_OFF / WIFI_OFF / SCAN_IN_PROGRESS) when
     * a scan can't even be attempted.
     */
    @PluginMethod
    public void scan(final PluginCall call) {
        // getInt, not getLong: a JS number arrives as an Integer, and getLong would
        // silently fall back to the default for it.
        int requested = call.getInt("timeoutMs", DEFAULT_SCAN_TIMEOUT_MS);
        final long timeoutMs = Math.max(1000, Math.min(requested, MAX_SCAN_TIMEOUT_MS));
        main.post(() -> beginScan(call, timeoutMs));
    }

    private void beginScan(PluginCall call, long timeoutMs) {
        if (pending != null) {
            call.reject("A scan is already in progress", "SCAN_IN_PROGRESS");
            return;
        }
        WifiManager wifi = wifiManager();
        if (wifi == null) {
            call.reject("This device has no WiFi", "WIFI_UNAVAILABLE");
            return;
        }
        if (!isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.reject("Precise location permission is required to scan", "PERMISSION_DENIED");
            return;
        }
        if (!locationServicesOn()) {
            call.reject("Location is turned off on this device", "LOCATION_OFF");
            return;
        }
        if (!wifi.isWifiEnabled() && !scanAlwaysAvailable(wifi)) {
            call.reject("WiFi is off and background Wi-Fi scanning is disabled", "WIFI_OFF");
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

    /**
     * "Wi-Fi scanning" in Location settings: the radio can scan even with WiFi off.
     * Deprecated alongside startScan() (API 29) and, like it, still functional.
     */
    @SuppressWarnings("deprecation")
    private static boolean scanAlwaysAvailable(WifiManager wifi) {
        return wifi.isScanAlwaysAvailable();
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
            settle(scan, "empty");
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
        out.put("cachedCount", results.size());

        if ("fresh".equals(outcome)) {
            JSArray aps = new JSArray();
            int dropped = 0;
            for (ScanResult r : results) {
                if (r.timestamp < scan.requestedAtUs) {
                    // Left in the OS cache from an earlier scan. It wasn't seen at this
                    // point, so it doesn't belong in this point's rows.
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
            // How long before the tap the newest thing Android had was seen. Shown to the
            // user so "stale" comes with a number, not just a label.
            out.put("newestResultAgeMs", Math.max(0L, (scan.requestedAtUs - newest) / 1000L));
        }
        scan.call.resolve(out);
    }

    private void settleWithError(PendingScan scan, String message, String code) {
        if (release(scan)) {
            scan.call.reject(message, code);
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
        ap.put("bssid", r.BSSID == null ? "" : r.BSSID.toLowerCase(Locale.US));
        // ScanResult.SSID is the raw name without WifiInfo-style quotes; "" for hidden networks.
        ap.put("ssid", r.SSID == null ? "" : r.SSID);
        ap.put("rssi", r.level);
        ap.put("frequencyMhz", r.frequency);
        return ap;
    }

    @Override
    protected void handleOnDestroy() {
        PendingScan scan = pending;
        if (scan != null) {
            settleWithError(scan, "App closed during the scan", "CANCELLED");
        }
        io.shutdown();
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

    // ------------------------------------------------------------------ the CSV log

    /**
     * Append CSV lines to the log, writing the header first if the file is new. JS owns
     * the schema and the escaping (src/csv.js). This side only makes the write durable.
     */
    @PluginMethod
    public void appendLog(PluginCall call) {
        final String header = call.getString("header");
        final JSArray lines = call.getArray("lines");
        if (header == null || header.isEmpty() || lines == null || lines.length() == 0) {
            call.reject("Missing 'header' or 'lines'");
            return;
        }
        io.execute(() -> {
            try {
                File file = logFile();
                StringBuilder chunk = new StringBuilder();
                if (!file.exists() || file.length() == 0) {
                    chunk.append(header).append('\n');
                } else if (!header.equals(readFirstLine(file))) {
                    // A log from a build with different columns. Appending would put rows
                    // under the wrong header, so refuse rather than corrupt it.
                    call.reject(
                        "The log on this phone uses an older column layout. Share it, then clear the app's storage to start a new one.",
                        "SCHEMA_MISMATCH"
                    );
                    return;
                } else if (!endsWithNewline(file)) {
                    // A write cut short (phone died mid-append) left a partial last line;
                    // start on a fresh line so the damage stays in that one row.
                    chunk.append('\n');
                }
                for (int i = 0; i < lines.length(); i++) {
                    chunk.append(lines.getString(i)).append('\n');
                }
                try (FileOutputStream out = new FileOutputStream(file, true)) {
                    out.write(chunk.toString().getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    // fsync: a survey point should survive the phone dying in the field.
                    out.getFD().sync();
                }
                call.resolve(logInfo());
            } catch (Exception e) {
                Log.e(TAG, "appendLog failed", e);
                call.reject("Could not write the log: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    @PluginMethod
    public void getLogInfo(PluginCall call) {
        io.execute(() -> {
            try {
                call.resolve(logInfo());
            } catch (Exception e) {
                call.reject("Could not read the log: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    /**
     * Share a snapshot of the log through the system share sheet (Gmail, Drive, Quick
     * Share...). The snapshot is a timestamped copy, so points logged afterwards can't
     * change a file another app is still uploading.
     */
    @PluginMethod
    public void shareLog(PluginCall call) {
        io.execute(() -> {
            try {
                File source = logFile();
                if (!source.exists() || source.length() == 0) {
                    call.reject("Nothing logged yet", "EMPTY_LOG");
                    return;
                }
                File dir = new File(getContext().getCacheDir(), SHARE_DIR);
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("Could not create the share directory", "IO_ERROR");
                    return;
                }
                pruneOldSnapshots(dir);

                String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
                File snapshot = new File(dir, "wifi_survey_" + stamp + ".csv");
                copy(source, snapshot);

                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", snapshot);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/csv");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.putExtra(Intent.EXTRA_SUBJECT, "LOCUS WiFi survey " + stamp);
                // ClipData carries the read grant through the chooser to the chosen app.
                send.setClipData(ClipData.newRawUri(snapshot.getName(), uri));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, "Share survey log");

                Activity activity = getActivity();
                if (activity == null) {
                    call.reject("No activity available");
                    return;
                }
                activity.runOnUiThread(() -> activity.startActivity(chooser));

                JSObject result = logInfo();
                result.put("fileName", snapshot.getName());
                call.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "shareLog failed", e);
                call.reject("Could not share the log: " + e.getMessage(), "IO_ERROR", e);
            }
        });
    }

    private File logFile() {
        return new File(getContext().getFilesDir(), LOG_FILE_NAME);
    }

    /**
     * Scan the file for its row count, distinct points and highest point_id. The file on
     * disk is the only record of which IDs are taken, so point_id keeps counting up after
     * an app restart instead of reusing numbers.
     *
     * Parsing tracks quotes, because a quoted SSID may itself contain a newline and that
     * must not be read as the start of a new row.
     */
    private JSObject logInfo() throws IOException {
        File file = logFile();
        JSObject info = new JSObject();
        info.put("path", file.getAbsolutePath());
        info.put("exists", file.exists());
        info.put("bytes", file.exists() ? file.length() : 0);

        int rows = 0;
        int lastPointId = 0;
        Set<Integer> points = new HashSet<>();
        if (file.exists()) {
            try (Reader in = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
                StringBuilder firstField = new StringBuilder();
                boolean inQuotes = false;
                boolean inFirstField = true;
                int c;
                while ((c = in.read()) != -1) {
                    if (c == '"') {
                        inQuotes = !inQuotes; // "" toggles twice, so escaped quotes are neutral
                    } else if (!inQuotes && c == ',') {
                        inFirstField = false;
                    } else if (!inQuotes && c == '\n') {
                        Integer id = parsePointId(firstField);
                        if (id != null) {
                            rows++;
                            points.add(id);
                            lastPointId = Math.max(lastPointId, id);
                        }
                        firstField.setLength(0);
                        inFirstField = true;
                        continue;
                    }
                    if (inFirstField && c != '"') {
                        firstField.append((char) c);
                    }
                }
            }
        }
        info.put("rows", rows);
        info.put("points", points.size());
        info.put("lastPointId", lastPointId);
        return info;
    }

    private static String readFirstLine(File file) throws IOException {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            String line = in.readLine();
            return line == null ? "" : line;
        }
    }

    private static boolean endsWithNewline(File file) throws IOException {
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            raf.seek(file.length() - 1);
            return raf.read() == '\n';
        }
    }

    /** The header's "point_id" (or any non-integer) is not a data row. */
    private static Integer parsePointId(CharSequence field) {
        String text = field.toString().trim();
        if (text.isEmpty()) {
            return null;
        }
        try {
            return Integer.parseInt(text);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static void pruneOldSnapshots(File dir) {
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        long cutoff = System.currentTimeMillis() - SHARE_SNAPSHOT_MAX_AGE_MS;
        for (File f : files) {
            if (f.lastModified() < cutoff) {
                f.delete();
            }
        }
    }

    private static void copy(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }
}
