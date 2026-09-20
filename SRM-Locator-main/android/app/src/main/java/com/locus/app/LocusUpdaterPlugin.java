package com.locus.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Native half of LOCUS's full-APK self-updater (Phase 1).
 *
 * Deliberately hand-rolled rather than pulled from npm: the only community Capacitor
 * plugins exposing the package-install intent are pre-1.0 and roughly a year stale (see
 * UPDATER.md), and going native here also avoids adding @capacitor/filesystem purely to
 * stream a file into the cache dir. Three responsibilities, nothing more:
 *
 *   1. download()  - stream an APK into cacheDir/updates with progress events, hashing
 *                    as it goes so verification costs no second pass over the file.
 *   2. install()   - hand the APK to the system installer via FileProvider + ACTION_VIEW.
 *   3. permission  - query and deep-link Android's per-app "install unknown apps" consent.
 *
 * The JS side owns all policy (when to check, whether an update is mandatory, what the
 * expected checksum is); this class just refuses to resolve download() if the bytes on
 * disk do not hash to what JS said they should.
 */
@CapacitorPlugin(name = "LocusUpdater")
public class LocusUpdaterPlugin extends Plugin {

    private static final String TAG = "LocusUpdater";
    private static final String UPDATE_DIR = "updates";
    private static final String PROGRESS_EVENT = "downloadProgress";
    private static final int CONNECT_TIMEOUT_MS = 20000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int BUFFER_SIZE = 64 * 1024;
    /** Throttle progress events; the WebView does not need one per 64KB chunk. */
    private static final long PROGRESS_INTERVAL_MS = 150;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean cancelled = new AtomicBoolean(false);

    /**
     * Whether this app may ask the system to install packages.
     *
     * Below API 26 this is a single device-wide "Unknown sources" toggle that an app
     * cannot query, so we report granted and let the installer surface its own dialog.
     */
    @PluginMethod
    public void getInstallPermissionStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", canRequestPackageInstalls());
        call.resolve(result);
    }

    /**
     * Deep-link to this app's own "Install unknown apps" screen. Android remembers the
     * grant per-package, so this is a one-time detour on the first update only.
     */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Not applicable below Android 8.0");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(intent);
        call.resolve();
    }

    /** Abort an in-flight download; the partial file is discarded. */
    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelled.set(true);
        call.resolve();
    }

    /** Delete any previously downloaded APKs. Called after a successful install hand-off. */
    @PluginMethod
    public void clearCache(PluginCall call) {
        purgeUpdateDir();
        call.resolve();
    }

    /**
     * Download an APK to the app cache and verify its SHA-256.
     *
     * @param url       absolute HTTPS URL of the APK asset
     * @param sha256    expected digest, 64 hex chars (case-insensitive)
     * @param fileName  optional file name within cacheDir/updates
     */
    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String expectedSha = call.getString("sha256");
        final String fileName = call.getString("fileName", "locus-update.apk");

        if (url == null || url.isEmpty()) {
            call.reject("Missing 'url'");
            return;
        }
        if (expectedSha == null || !expectedSha.matches("(?i)^[0-9a-f]{64}$")) {
            // Refusing up front rather than downloading first: a release without a usable
            // checksum can never be installed, so there is no point spending the bytes.
            call.reject("Missing or malformed 'sha256'", "CHECKSUM_MISSING");
            return;
        }

        cancelled.set(false);
        executor.execute(new Runnable() {
            @Override
            public void run() {
                runDownload(call, url, expectedSha, fileName);
            }
        });
    }

    private void runDownload(PluginCall call, String url, String expectedSha, String fileName) {
        File target = null;
        HttpURLConnection connection = null;
        try {
            File dir = new File(getContext().getCacheDir(), UPDATE_DIR);
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Could not create update cache directory", "IO_ERROR");
                return;
            }
            // Start from a clean slate so a stale or partial APK from a previous attempt
            // can never be mistaken for the freshly verified one.
            purgeUpdateDir();
            target = new File(dir, sanitiseFileName(fileName));

            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.connect();

            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                call.reject("Download failed with HTTP " + status, "HTTP_" + status);
                return;
            }

            long total = connection.getContentLengthLong();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[BUFFER_SIZE];
            long received = 0;
            long lastEmit = 0;

            InputStream in = null;
            OutputStream out = null;
            try {
                in = connection.getInputStream();
                out = new FileOutputStream(target);
                int read;
                while ((read = in.read(buffer)) != -1) {
                    if (cancelled.get()) {
                        call.reject("Download cancelled", "CANCELLED");
                        return;
                    }
                    out.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    received += read;

                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
                        emitProgress(received, total);
                        lastEmit = now;
                    }
                }
                out.flush();
            } finally {
                closeQuietly(out);
                closeQuietly(in);
            }
            emitProgress(received, total);

            String actualSha = toHex(digest.digest());
            if (!actualSha.equalsIgnoreCase(expectedSha)) {
                Log.w(TAG, "Checksum mismatch: expected " + expectedSha + " got " + actualSha);
                // Never leave an unverified APK sitting in a FileProvider-exposed directory.
                purgeUpdateDir();
                JSObject detail = new JSObject();
                detail.put("expected", expectedSha.toLowerCase(Locale.US));
                detail.put("actual", actualSha);
                call.reject("Checksum mismatch - download rejected", "CHECKSUM_MISMATCH", null, detail);
                return;
            }

            JSObject result = new JSObject();
            result.put("path", target.getAbsolutePath());
            result.put("bytes", received);
            result.put("sha256", actualSha);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Download failed", e);
            if (target != null) {
                target.delete();
            }
            call.reject(e.getMessage() == null ? "Download failed" : e.getMessage(), "IO_ERROR", e);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    /**
     * Hand a verified APK to the system package installer.
     *
     * Resolving does NOT mean the update was installed - it means Android's installer UI
     * was launched. The app is killed and replaced if the user confirms, so there is no
     * success callback to wait for.
     */
    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Missing 'path'");
            return;
        }
        File apk = new File(path);
        if (!apk.exists()) {
            call.reject("APK not found at " + path, "NOT_FOUND");
            return;
        }
        // Belt and braces: only ever install out of our own cache dir, never an arbitrary
        // path handed in from the WebView.
        File expectedDir = new File(getContext().getCacheDir(), UPDATE_DIR);
        try {
            String apkPath = apk.getCanonicalPath();
            String dirPath = expectedDir.getCanonicalPath() + File.separator;
            if (!apkPath.startsWith(dirPath)) {
                call.reject("Refusing to install from outside the update cache", "FORBIDDEN_PATH");
                return;
            }
        } catch (Exception e) {
            call.reject("Could not resolve APK path", "IO_ERROR", e);
            return;
        }
        if (!canRequestPackageInstalls()) {
            call.reject("Install permission not granted", "PERMISSION_DENIED");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available");
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Install intent failed", e);
            call.reject(e.getMessage() == null ? "Install failed" : e.getMessage(), "INSTALL_FAILED", e);
        }
    }

    private boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true;
        }
        PackageManager pm = getContext().getPackageManager();
        return pm != null && pm.canRequestPackageInstalls();
    }

    private void emitProgress(long received, long total) {
        JSObject progress = new JSObject();
        progress.put("loaded", received);
        progress.put("total", total);
        progress.put("percent", total > 0 ? (int) ((received * 100L) / total) : -1);
        notifyListeners(PROGRESS_EVENT, progress);
    }

    private void purgeUpdateDir() {
        File dir = new File(getContext().getCacheDir(), UPDATE_DIR);
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File file : files) {
            file.delete();
        }
    }

    /** Strip any path separators so a crafted fileName cannot escape the cache dir. */
    private String sanitiseFileName(String name) {
        String cleaned = name.replaceAll("[^A-Za-z0-9._-]", "_");
        return cleaned.isEmpty() ? "locus-update.apk" : cleaned;
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (Exception ignored) {
            // Nothing useful to do; the digest/checksum check is the real guard here.
        }
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16));
            sb.append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }
}
