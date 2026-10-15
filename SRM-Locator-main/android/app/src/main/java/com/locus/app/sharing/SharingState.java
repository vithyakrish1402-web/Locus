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

    // --- is the app live: in the foreground, with its JavaScript running? ---
    //
    // Followed through the activity's onResume and onPause, NOT onStart and onStop: the WebView
    // freezes its timers and socket at onPause (Capacitor's BridgeActivity.onPause), which can come
    // well before onStop, or without any onStop (split screen, a dialog over the app). These are
    // native callbacks, so they still fire when JavaScript has stopped.
    public interface LiveListener {
        void onLive(boolean live);
    }

    private static final java.util.concurrent.atomic.AtomicInteger resumedActivities = new java.util.concurrent.atomic.AtomicInteger();
    private static volatile LiveListener liveListener;

    public static boolean isAppLive() {
        return resumedActivities.get() > 0;
    }

    public static void setLiveListener(LiveListener l) {
        liveListener = l;
    }

    /** MainActivity.onResume */
    public static void activityResumed() {
        boolean was = isAppLive();
        resumedActivities.incrementAndGet();
        if (!was && liveListener != null) liveListener.onLive(true);
    }

    /** MainActivity.onPause */
    public static void activityPaused() {
        // Only a real change is reported: a stray pause with nothing resumed changes nothing.
        int before = resumedActivities.getAndUpdate(n -> Math.max(0, n - 1));
        if (before == 1 && liveListener != null) liveListener.onLive(false);
    }
}
