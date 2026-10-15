package com.locus.app.sharing;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.regex.Pattern;

/**
 * The app's handle on background sharing (Stage 3b). The JavaScript gets the device token from
 * the server (it alone holds the Firebase sign-in), then hands it here; this plugin never sees an
 * ID token or a Firebase refresh token.
 *
 *   getCapabilities()  { version, running, notificationsEnabled, locationGranted, resumable }
 *   start({ baseUrl, roomCode, groupName, deviceToken, expiresAt, pollingMs })
 *                      { started, state } - started false says why, in state:
 *                      "notifications-denied" (sharing must be visible, so it does not start without
 *                      notifications), "location-denied", "cannot-start"
 *   updateToken({ deviceToken, expiresAt })   renews the pass of a running service
 *   pause({ minutes }) 0 = until resumed;  resume();  stop({ reason })
 *   getState()         { state: running | paused | stopped, reason?, running }
 *   event "stateChanged" { state, reason? }   reason says why it stopped: user-stop (or whatever the
 *                      app passed to stop()), revoked, token-expired, forbidden, group-gone,
 *                      disabled, rejected, notifications-denied, location-denied,
 *                      restart-blocked, cannot-start-foreground, no-session
 * The standard requestPermissions({ permissions: ["location", "notifications"] }) asks for the two
 * runtime permissions; this plugin never prompts by itself.
 */
@CapacitorPlugin(
    name = "LocusBackground",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class LocusBackgroundPlugin extends Plugin {
    /** Bumped when the contract above changes; the JavaScript checks it before calling anything. */
    public static final int VERSION = 1;

    private static final Pattern TOKEN_SHAPE = Pattern.compile("[A-Za-z0-9._-]{1,600}");
    private static final int MAX_ROOM = 64;
    private static final int MAX_GROUP_NAME = 80;

    @Override
    public void load() {
        SharingState.setListener((state, reason) -> {
            JSObject data = new JSObject();
            data.put("state", state);
            if (reason != null) data.put("reason", reason);
            notifyListeners("stateChanged", data, true);
        });
    }

    @Override
    protected void handleOnDestroy() {
        SharingState.setListener(null);
        super.handleOnDestroy();
    }

    private boolean locationGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        JSObject r = new JSObject();
        r.put("version", VERSION);
        r.put("running", LocationShareService.isRunning());
        r.put("notificationsEnabled", SharingNotifications.canBeSeen(getContext()));
        r.put("locationGranted", locationGranted());
        r.put("resumable", SharingState.store(getContext()).resumeHint(System.currentTimeMillis()) != null);
        call.resolve(r);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", LocationShareService.isRunning());
        r.put("state", LocationShareService.isRunning() ? SharingState.lastState() : "stopped");
        if (!LocationShareService.isRunning() && SharingState.lastReason() != null) r.put("reason", SharingState.lastReason());
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String baseUrl = Endpoint.validate(call.getString("baseUrl"));
        String roomCode = call.getString("roomCode");
        String groupName = call.getString("groupName", "");
        String token = call.getString("deviceToken");
        long expiresAt = call.getLong("expiresAt", 0L);
        int polling = call.getInt("pollingMs", 5000);
        if (baseUrl == null || roomCode == null || roomCode.isEmpty() || roomCode.length() > MAX_ROOM
            || token == null || !TOKEN_SHAPE.matcher(token).matches() || expiresAt <= System.currentTimeMillis()) {
            call.reject("bad-arguments");
            return;
        }
        if (groupName.length() > MAX_GROUP_NAME) groupName = groupName.substring(0, MAX_GROUP_NAME);

        // Sharing has to be visible to the person, or it does not happen.
        if (!SharingNotifications.canBeSeen(getContext())) {
            call.resolve(refused("notifications-denied"));
            return;
        }
        if (!locationGranted()) {
            call.resolve(refused("location-denied"));
            return;
        }

        Session session = new Session(baseUrl, roomCode, groupName, token, expiresAt, polling);
        SharingState.setSession(session);
        // Sealed with the Keystore, or kept in memory only (sharing then ends with the service).
        boolean persisted = SharingState.store(getContext()).save(session);
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), LocationShareService.class).setAction(LocationShareService.ACTION_START));
        } catch (RuntimeException e) {
            SharingState.forget(getContext());
            call.resolve(refused("cannot-start"));
            return;
        }
        JSObject r = new JSObject();
        r.put("started", true);
        r.put("persisted", persisted);
        call.resolve(r);
    }

    private static JSObject refused(String why) {
        JSObject r = new JSObject();
        r.put("started", false);
        r.put("state", why);
        return r;
    }

    @PluginMethod
    public void updateToken(PluginCall call) {
        String token = call.getString("deviceToken");
        long expiresAt = call.getLong("expiresAt", 0L);
        Session current = SharingState.session();
        if (current == null || token == null || !TOKEN_SHAPE.matcher(token).matches() || expiresAt <= System.currentTimeMillis()) {
            call.reject("bad-arguments");
            return;
        }
        Session renewed = current.withToken(token, expiresAt);
        SharingState.setSession(renewed);
        SharingState.store(getContext()).save(renewed);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (!LocationShareService.isRunning()) {
            call.resolve();
            return;
        }
        sendToService(LocationShareService.ACTION_PAUSE, call.getInt("minutes", 0), null);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        if (LocationShareService.isRunning()) sendToService(LocationShareService.ACTION_RESUME, 0, null);
        call.resolve();
    }

    /**
     * Ends sharing for good and clears the token. With the service running it does this itself;
     * with it already gone (killed by the phone), the token that is left is wiped here and the
     * server told, so a logout or leaving a Group always finishes the job.
     */
    @PluginMethod
    public void stop(PluginCall call) {
        String reason = call.getString("reason", "user-stop");
        if (LocationShareService.isRunning()) {
            sendToService(LocationShareService.ACTION_STOP, 0, reason);
        } else {
            Session leftover = SharingState.session() != null ? SharingState.session() : SharingState.store(getContext()).load();
            SharingState.forget(getContext());
            SharingNotifications.cancelResume(getContext());
            if (leftover != null) {
                final Session ending = leftover;
                new Thread(() -> new UrlConnectionPoster().deleteSession(ending.baseUrl, ending.deviceToken)).start();
            }
            SharingState.emit("stopped", reason);
        }
        call.resolve();
    }

    private void sendToService(String action, int minutes, String reason) {
        Intent intent = new Intent(getContext(), LocationShareService.class).setAction(action).putExtra(LocationShareService.EXTRA_MINUTES, minutes);
        if (reason != null) intent.putExtra(LocationShareService.EXTRA_REASON, reason);
        try {
            getContext().startService(intent);
        } catch (RuntimeException e) {
            // The service is not allowed to be started from here right now; it is not running, so there is nothing to tell.
        }
    }
}
