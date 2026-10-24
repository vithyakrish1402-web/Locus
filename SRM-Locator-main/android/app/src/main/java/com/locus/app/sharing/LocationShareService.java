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

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.locus.app.alerts.AlertVolume;
import com.locus.app.alerts.AlertVolumeLedger;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Shares the person's position with their Group while LOCUS is closed, and listens for the
 * Group's SOS (see SosListener): an SOS from a teammate rings here as a loud alert when the app
 * is not on screen, as long as the person has not turned "SOS alerts when the app is closed" off.
 * Both end together: with sharing off, there is no service and so no alert.
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
    /** The person switched "SOS alerts when the app is closed" on or off in Settings. */
    public static final String ACTION_SOS_ALERTS = "com.locus.app.sharing.SOS_ALERTS";
    /** The app is showing that SOS (or the person acknowledged it): take its notification down. */
    public static final String ACTION_SOS_DISMISS = "com.locus.app.sharing.SOS_DISMISS";
    public static final String EXTRA_MINUTES = "minutes";
    public static final String EXTRA_REASON = "reason";
    public static final String EXTRA_SOS_ID = "sosId";

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

    // SOS heard while the app is closed
    private final SosLedger ledger = new SosLedger();
    private final Map<Integer, Runnable> quieters = new HashMap<>(); // slot -> "stop the sound of that alert"
    private final Map<Integer, SosAlert> alerting = new HashMap<>(); // slot -> the alert it shows
    private final Map<Integer, Long> alertedAt = new HashMap<>(); // slot -> when that alert reached this phone
    private SosListener sosListener;

    @Override
    public void onCreate() {
        super.onCreate();
        network = Executors.newSingleThreadExecutor();
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        SharingNotifications.ensureChannels(this);
        SosNotifications.ensureChannel(this);
        // A new service: anything an earlier one held the alarm volume up for is over.
        AlertVolume.releaseAll(this, AlertVolumeLedger.SERVICE);
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
            case ACTION_SOS_ALERTS:
                updateSosListening();
                break;
            case ACTION_SOS_DISMISS:
                dismissSos(intent.getStringExtra(EXTRA_SOS_ID));
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
            SharingState.acknowledgeStop(this);
            SharingNotifications.cancelEnded(this); // sharing is on again: an old "ended" notice is no longer true
            registerUpdates();
            if (!started) return; // location was refused and sharing has already ended
            updateSosListening();
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

    // --- SOS from the Group, heard while the app is closed -------------------------------------------

    private final SosListener.Host sosHost = new SosListener.Host() {
        @Override
        public Session session() {
            return SharingState.session();
        }

        @Override
        public void deliver(List<SosAlert> alerts) {
            onSosHeard(alerts);
        }

        // People waiting to join (for the Group's admitters): shown while the app is not on screen,
        // where its own badge and notice say it; taken down when nobody is waiting.
        @Override
        public void deliverJoin(JoinNotice notice) {
            if (notice.count <= 0) {
                JoinNotifications.cancel(LocationShareService.this);
                return;
            }
            if (SharingState.isAppLive()) return;
            Session session = SharingState.session();
            JoinNotifications.show(LocationShareService.this, notice.count, session == null ? null : session.groupName);
        }
    };

    /** Listening runs exactly while sharing runs and the person has not turned these alerts off. */
    private void updateSosListening() {
        boolean want = started && SosPrefs.enabled(this);
        if (want && sosListener == null) {
            sosListener = new SosListener(sosHost, main::post, Math::random);
            sosListener.start();
        } else if (!want && sosListener != null) {
            sosListener.stop();
            sosListener = null;
        }
    }

    private void onSosHeard(List<SosAlert> alerts) {
        if (!started || sosListener == null) return;
        long now = System.currentTimeMillis();
        boolean enabled = SosPrefs.enabled(this);
        for (SosAlert alert : alerts) {
            // The app on screen has its own overlay for this: no second alert from here.
            SosLedger.Decision decision = ledger.decide(alert, SharingState.isAppLive(), enabled, now);
            if (decision.verdict == SosLedger.Verdict.IGNORE) continue;
            boolean loud = decision.verdict == SosLedger.Verdict.ALERT;
            alerting.put(decision.slot, alert);
            alertedAt.put(decision.slot, now); // when this version of the alert reached this phone
            // Loud: the alarm volume is held up for it until it is quietened, dealt with or swiped away.
            if (loud) AlertVolume.raise(this, SosNotifications.volumeHolder(decision.slot));
            SosNotifications.post(this, alert, decision.slot, loud, now);
            if (loud) scheduleQuiet(decision.slot);
        }
    }

    /** The app is showing this SOS: its notification goes, and nothing re-posts it. */
    private void dismissSos(String sosId) {
        if (sosId == null) return;
        int slot = ledger.slotOf(sosId);
        if (slot < 0) return;
        Runnable quiet = quieters.remove(slot);
        if (quiet != null) main.removeCallbacks(quiet);
        alerting.remove(slot);
        alertedAt.remove(slot);
        SosNotifications.cancel(this, slot);
        AlertVolume.release(this, SosNotifications.volumeHolder(slot));
    }

    /** After SOS_ALERT_AUTO_TIMEOUT_MS the sound stops; the notification stays until it is dealt with. */
    private void scheduleQuiet(final int slot) {
        Runnable earlier = quieters.remove(slot);
        if (earlier != null) main.removeCallbacks(earlier);
        Runnable quiet = () -> {
            quieters.remove(slot);
            quietAlert(slot);
        };
        quieters.put(slot, quiet);
        main.postDelayed(quiet, SosNotifications.SOS_ALERT_AUTO_TIMEOUT_MS);
    }

    private void quietAlert(int slot) {
        SosAlert alert = alerting.get(slot);
        if (alert == null) return;
        SosNotifications.cancel(this, slot); // a ringing notification only stops when it is taken down
        SosNotifications.post(this, alert, slot, false, alertedAt.getOrDefault(slot, System.currentTimeMillis()));
        AlertVolume.release(this, SosNotifications.volumeHolder(slot));
    }

    /** The service is going: no alert is left ringing with nobody to quieten it. */
    private void quietAllAlerts() {
        for (Map.Entry<Integer, Runnable> entry : new HashMap<>(quieters).entrySet()) {
            main.removeCallbacks(entry.getValue());
            quietAlert(entry.getKey());
        }
        quieters.clear();
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
        updateSosListening(); // started is false now: stops listening
        SharingState.forget(this);
        SharingState.stopNote(this).record(reason);
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
        quietAllAlerts();
        main.removeCallbacksAndMessages(null);
        SharingState.setLiveListener(null);
        removeUpdates();
        started = false;
        running = false;
        updateSosListening();
        if (network != null) network.shutdown(); // lets a pending stop notice finish
        super.onDestroy();
    }
}
