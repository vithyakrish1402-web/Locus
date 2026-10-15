package com.locus.app.sharing;

import android.content.Context;

/**
 * The few pieces of state shared between the plugin (the app's side) and the service: the
 * session in memory, the state the JavaScript is told about, whether the app is on screen, and
 * the sealed copy on disk. All static because the two live in one process and the service can
 * be restarted by Android without the plugin existing.
 */
public final class SharingState {
    private SharingState() {}

    // --- the session, in memory ---
    private static volatile Session session;

    public static Session session() {
        return session;
    }

    public static void setSession(Session s) {
        session = s;
    }

    // --- the sealed copy on disk ---
    public static TokenStore store(Context context) {
        return new TokenStore(new KeystoreSecretBox(), new FileKeyValue(new java.io.File(context.getApplicationContext().getNoBackupFilesDir(), "locus_sharing")));
    }

    /** Forgets the session everywhere: memory and disk. */
    public static void forget(Context context) {
        session = null;
        store(context).clear();
    }

    // --- what the JavaScript is told ---
    /** Called on the main thread whenever the state changes. */
    public interface Listener {
        void onState(String state, String reason);
    }

    private static volatile Listener listener;
    private static volatile String lastState = "stopped";
    private static volatile String lastReason = null;

    public static void setListener(Listener l) {
        listener = l;
    }

    public static String lastState() {
        return lastState;
    }

    public static String lastReason() {
        return lastReason;
    }

    /** state: "running", "paused" or "stopped"; reason only for "stopped". */
    public static void emit(String state, String reason) {
        lastState = state;
        lastReason = reason;
        Listener l = listener;
        if (l != null) l.onState(state, reason);
    }

    // --- is the app on screen? ---
    public interface VisibilityListener {
        void onVisibility(boolean visible);
    }

    private static final java.util.concurrent.atomic.AtomicInteger startedActivities = new java.util.concurrent.atomic.AtomicInteger();
    private static volatile VisibilityListener visibilityListener;

    public static boolean isAppVisible() {
        return startedActivities.get() > 0;
    }

    public static void setVisibilityListener(VisibilityListener l) {
        visibilityListener = l;
    }

    /** MainActivity.onStart */
    public static void activityStarted() {
        boolean was = isAppVisible();
        startedActivities.incrementAndGet();
        if (!was && visibilityListener != null) visibilityListener.onVisibility(true);
    }

    /** MainActivity.onStop */
    public static void activityStopped() {
        if (startedActivities.updateAndGet(n -> Math.max(0, n - 1)) == 0 && visibilityListener != null) visibilityListener.onVisibility(false);
    }
}
