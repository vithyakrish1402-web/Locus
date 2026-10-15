package com.locus.app.sharing;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Shares the person's position with their Group while LOCUS is closed.
 *
 * A foreground service of type "location", started by the app only while it is on screen (the
 * only time Android 12+ allows it). It reports over HTTPS with the device token the app gave it,
 * never over the socket, never logs a token or a coordinate, and holds nothing it was not given.
 *
 * Who reports, and when: see ReportPlanner. In short: while the app is live (foreground, JavaScript
 * running) its own socket is the source and the service sends only a light 30 s heartbeat, so the
 * person's place is already held. From the moment the activity is PAUSED (Home, screen off, split
 * screen: the WebView freezes right then, long before any swipe) the service reports real GPS at the
 * adaptive rate, starting with the first fix taken after that moment (see AdaptiveRate).
 *
 * The service ends itself, clearing the token, when: the person stops it (notification or app),
 * the server says the pass is finished (401, 403, 410, switched off), notifications or location
 * are no longer allowed, or the pass runs out. If Android restarts it while the app is not
 * visible and that is not allowed, it posts "Tap to resume sharing with ..." and stops: it never
 * crashes and never retries in a loop.
 */
public class LocationShareService extends Service implements LocationListener {
    public static final String ACTION_START = "com.locus.app.sharing.START";
    public static final String ACTION_PAUSE = "com.locus.app.sharing.PAUSE";
    public static final String ACTION_RESUME = "com.locus.app.sharing.RESUME";
    public static final String ACTION_STOP = "com.locus.app.sharing.STOP";
    public static final String EXTRA_MINUTES = "minutes";
    public static final String EXTRA_REASON = "reason";

    private static final long TICK_MS = 5_000;
    private static volatile boolean running = false;

    public static boolean isRunning() {
        return running;
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final UrlConnectionPoster poster = new UrlConnectionPoster();
    private final Backoff backoff = new Backoff(Math::random);
    private final PauseState pause = new PauseState();
    private ExecutorService network;
    private LocationManager locationManager;

    private Session session;
    private AdaptiveRate rate;
    private ReportPlanner planner;
    private OutageTracker outage;
    private boolean started = false;
    private boolean posting = false;
    private boolean updatesOn = false;
    private long requestedIntervalMs = -1;
    private boolean wasPaused = false;

    @Override
    public void onCreate() {
        super.onCreate();
        network = Executors.newSingleThreadExecutor();
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        SharingNotifications.ensureChannels(this);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_START.equals(action)) return handleStart();
        if (action == null) return handleSystemRestart();
        if (!started) {
            // A button on an old notification, for a service that is not sharing.
            stopSelf();
            return START_NOT_STICKY;
        }
        switch (action) {
            case ACTION_PAUSE:
                pauseSharing(intent.getIntExtra(EXTRA_MINUTES, 15));
                break;
            case ACTION_RESUME:
                resumeSharing();
                break;
            case ACTION_STOP:
                String reason = intent.getStringExtra(EXTRA_REASON);
                endSharing(reason == null ? "user-stop" : reason, true);
                return START_NOT_STICKY;
            default:
                break;
        }
        return START_STICKY;
    }

    // --- starting ---------------------------------------------------------------------------

    private int handleStart() {
        Session wanted = SharingState.session();
        // Started with startForegroundService: it must show its notification at once.
        if (!enterForeground(wanted == null ? null : wanted.groupName)) return START_NOT_STICKY;
        if (wanted == null) {
            endSharing("no-session", false);
            return START_NOT_STICKY;
        }
        if (!SharingNotifications.canBeSeen(this)) {
            endSharing("notifications-denied", false);
            return START_NOT_STICKY;
        }
        if (!hasLocationPermission()) {
            endSharing("location-denied", false);
            return START_NOT_STICKY;
        }
        begin(wanted);
        return START_STICKY;
    }

    /** Android started us again after killing us (the intent is null). That is a background start. */
    private int handleSystemRestart() {
        Session remembered = SharingState.session();
        if (remembered == null) remembered = SharingState.store(this).load();
        ServicePolicy.Restart decision = ServicePolicy.onSystemRestart(
            remembered, System.currentTimeMillis(), SharingNotifications.canBeSeen(this), hasLocationPermission());
        if (decision == ServicePolicy.Restart.STOP_QUIETLY) {
            SharingState.forget(this);
            SharingState.emit("stopped", "restart-nothing-to-resume");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (decision == ServicePolicy.Restart.TELL_TO_RESUME) {
            tellToResume(remembered);
            return START_NOT_STICKY;
        }
        SharingState.setSession(remembered);
        if (!enterForeground(remembered.groupName)) return START_NOT_STICKY;
        begin(remembered);
        return START_STICKY;
    }

    private void tellToResume(Session s) {
        SharingNotifications.postResume(this, s == null ? null : s.groupName);
        SharingState.emit("stopped", "restart-blocked");
        stopSelf();
    }

    /** Shows the permanent notification. False (after posting the resume notice) if Android says no. */
    @SuppressLint("InlinedApi") // the constant is inlined at build time; ServiceCompat ignores the type before Android 10
    private boolean enterForeground(String groupName) {
        try {
            Notification notification = SharingNotifications.sharing(this, groupName, false);
            ServiceCompat.startForeground(this, SharingNotifications.SHARING_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            return true;
        } catch (Exception e) {
            // Android 12+: a background start is not allowed; Android 14+: no location access to
            // start with. Say so once and stop; do not crash and do not try again.
            SharingNotifications.postResume(this, groupName);
            SharingState.emit("stopped", "cannot-start-foreground");
            stopSelf();
            return false;
        }
    }

    private void begin(Session s) {
        session = s;
        if (!started) {
            started = true;
            running = true;
            rate = new AdaptiveRate(s.pollingMs);
            planner = new ReportPlanner(rate, SharingState.isAppLive());
            outage = new OutageTracker(SharingState.outageGiveUpMs());
            SharingNotifications.cancelEnded(this); // sharing is on again: an old "ended" notice is no longer true
            registerUpdates();
            if (!started) return; // location was refused and sharing has already ended
            SharingState.setLiveListener(this::onLiveChanged);
            main.postDelayed(tick, TICK_MS);
            SharingState.emit("running", null);
        } else {
            rate = new AdaptiveRate(s.pollingMs);
            planner.setRate(rate);
            retune();
        }
        planner.reportSoon(); // report straight away
        refreshNotification();
        maybePost();
    }

    // --- pause, resume ----------------------------------------------------------------------

    private void pauseSharing(int minutes) {
        pause.pause(minutes <= 0 ? 0 : minutes * 60_000L, System.currentTimeMillis(), planner.lastFix());
        wasPaused = true;
        removeUpdates();
        planner.reportSoon();
        refreshNotification();
        SharingState.emit("paused", null);
        maybePost();
    }

    private void resumeSharing() {
        pause.resume();
        wasPaused = false;
        registerUpdates();
        planner.reportSoon();
        refreshNotification();
        SharingState.emit("running", null);
    }

    // --- the loop ---------------------------------------------------------------------------

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!started) return;
            long now = System.currentTimeMillis();
            if (now >= session.expiresAtMs) {
                endSharing(ResponseHandler.TOKEN_EXPIRED, false);
                return;
            }
            if (wasPaused && !pause.isPaused(now)) resumeSharing(); // the pause ran out
            maybePost();
            main.postDelayed(this, TICK_MS);
        }
    };

    /**
     * The app went to or came from the foreground (the activity's onResume and onPause: see
     * ReportPlanner). Called on the main thread, from the lifecycle callback itself, so the switch
     * is immediate: from here on the service asks for fixes at the full rate, asks for one right now,
     * and reports the first fix taken after this moment.
     */
    private void onLiveChanged(boolean live) {
        if (!started) return;
        planner.setLive(live, System.currentTimeMillis());
        retune();
        if (!live) requestFreshFix();
        maybePost();
    }

    private void maybePost() {
        if (!started || posting) return;
        long now = System.currentTimeMillis();
        boolean paused = pause.isPaused(now);
        ReportPlanner.Plan plan = planner.plan(now, paused, pause.held(), batteryPercent());
        if (!plan.post) return;
        String body = ReportJson.build(plan.fix, pause.status(now), AdaptiveRate.nextPostWithinSec(plan.gapMs), batteryPercent());
        if (body == null) return;
        final Session sending = session;
        posting = true;
        planner.onPosted(now);
        network.execute(() -> {
            HttpResult result = poster.postLocation(sending.baseUrl, sending.deviceToken, body);
            main.post(() -> onPosted(result));
        });
    }

    private void onPosted(HttpResult result) {
        posting = false;
        if (!started) return;
        Outcome outcome = ResponseHandler.forLocation(result, backoff);
        long now = System.currentTimeMillis();
        // Any answer, even a refusal, means the server is back; no answer, 502, 503 or 504 is an outage.
        boolean unreachable = outcome.action == Outcome.Action.RETRY && outcome.serverUnreachable;
        if (outage.observe(!unreachable, now)) {
            endSharing(ReasonNotice.SERVER_UNREACHABLE, false);
            return;
        }
        switch (outcome.action) {
            case RETRY:
                planner.holdOff(now, outcome.delayMs);
                break;
            case STOP:
                endSharing(outcome.stopReason, false);
                break;
            default:
                break;
        }
    }

    // --- location ---------------------------------------------------------------------------

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private String chooseProvider() {
        boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (fine && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) return LocationManager.GPS_PROVIDER;
        if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) return LocationManager.NETWORK_PROVIDER;
        return null;
    }

    private long wantedRequestMs() {
        return planner.requestIntervalMs(batteryPercent());
    }

    private void registerUpdates() {
        if (updatesOn || pause.isPaused(System.currentTimeMillis())) return;
        try {
            String provider = chooseProvider();
            if (provider == null) return; // location is switched off on the phone; the tick keeps trying
            long interval = wantedRequestMs();
            locationManager.requestLocationUpdates(provider, interval, 0f, this, Looper.getMainLooper());
            updatesOn = true;
            requestedIntervalMs = interval;
            Location last = locationManager.getLastKnownLocation(provider);
            if (last != null && System.currentTimeMillis() - last.getTime() < 60_000) accept(last);
        } catch (SecurityException e) {
            // Location access is not available to us now (on Android 14+, typically after a
            // restart in the background). Not a crash and not a loop: say so and stop.
            SharingNotifications.postResume(this, session == null ? null : session.groupName);
            endSharing("location-denied", false);
        }
    }

    private void removeUpdates() {
        if (!updatesOn) return;
        try {
            locationManager.removeUpdates(this);
        } catch (SecurityException e) {
            // nothing to remove
        }
        updatesOn = false;
        requestedIntervalMs = -1;
    }

    /** Ask the phone for fixes at the pace the rate now wants, if that has moved enough. */
    private void retune() {
        if (!updatesOn) return;
        long wanted = wantedRequestMs();
        if (requestedIntervalMs < 0 || Math.abs(wanted - requestedIntervalMs) * 5 > requestedIntervalMs) {
            removeUpdates();
            registerUpdates();
        }
    }

    private void accept(Location l) {
        planner.onFix(new Fix(
            l.getLatitude(), l.getLongitude(),
            l.hasAccuracy() ? l.getAccuracy() : Double.NaN,
            l.hasSpeed() ? l.getSpeed() : Double.NaN,
            l.hasBearing() ? l.getBearing() : Double.NaN,
            System.currentTimeMillis()));
    }

    /** Asks the phone for one fix right now (Android 11+), rather than waiting for the next scheduled one. */
    private void requestFreshFix() {
        if (Build.VERSION.SDK_INT < 30 || !updatesOn) return;
        try {
            String provider = chooseProvider();
            if (provider == null) return;
            locationManager.getCurrentLocation(provider, null, ContextCompat.getMainExecutor(this), location -> {
                if (location != null && started) {
                    accept(location);
                    maybePost();
                }
            });
        } catch (SecurityException e) {
            // no location access right now; the scheduled updates are the fallback
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (!started) return;
        accept(location);
        retune();
        maybePost();
    }

    @Override
    public void onProviderEnabled(String provider) {
        if (started && !updatesOn) registerUpdates();
    }

    @Override
    public void onProviderDisabled(String provider) {
        if (!started) return;
        removeUpdates();
        registerUpdates(); // another provider, if there is one
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onStatusChanged(String provider, int status, Bundle extras) {
        // Deprecated, and required to implement before Android 11.
    }

    private int batteryPercent() {
        BatteryManager battery = (BatteryManager) getSystemService(BATTERY_SERVICE);
        if (battery == null) return -1;
        int pct = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return pct <= 0 || pct > 100 ? -1 : pct;
    }

    // --- the notification, and the end ----------------------------------------------------------

    private void refreshNotification() {
        Notification notification = SharingNotifications.sharing(this, session == null ? null : session.groupName, pause.isPaused(System.currentTimeMillis()));
        try {
            getSystemService(NotificationManager.class).notify(SharingNotifications.SHARING_ID, notification);
        } catch (RuntimeException e) {
            // Cannot update it; it is still showing.
        }
    }

    /**
     * Ends sharing for good: the token is wiped (memory and disk), the state tells the app why, and
     * if the person chose to stop (or left or logged out) the server is told best-effort so the
     * pass is finished there too.
     */
    private void endSharing(String reason, boolean tellServer) {
        main.removeCallbacks(tick);
        SharingState.setLiveListener(null);
        removeUpdates();
        final Session ending = session != null ? session : SharingState.session();
        started = false;
        running = false;
        SharingState.forget(this);
        SharingState.emit("stopped", reason);
        stopForeground(STOP_FOREGROUND_REMOVE);
        // Not asked for, and the app may be closed: say so instead of vanishing.
        SharingNotifications.postEnded(this, ReasonNotice.forStopReason(reason));
        if (tellServer && ending != null) {
            network.execute(() -> {
                poster.deleteSession(ending.baseUrl, ending.deviceToken);
                main.post(this::stopSelf);
            });
        } else {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        main.removeCallbacksAndMessages(null);
        SharingState.setLiveListener(null);
        removeUpdates();
        started = false;
        running = false;
        if (network != null) network.shutdown(); // lets a pending stop notice finish
        super.onDestroy();
    }
}
