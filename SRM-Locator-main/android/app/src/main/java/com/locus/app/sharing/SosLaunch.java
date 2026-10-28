package com.locus.app.sharing;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.view.WindowManager;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

import com.locus.app.MainActivity;

/**
 * The hand-over from an SOS notification to the app. Tapping the notification (or the full-screen
 * alert it raises on a locked phone) starts LOCUS with an intent that carries the alert; the
 * LocusBackground plugin passes it on to the app as a "sosOpened" event and the app shows the
 * alert it already has (the SOS overlay, with the sender's last known location). No new screen.
 */
public final class SosLaunch {
    public static final String ACTION_OPEN = "com.locus.app.sos.OPEN";
    public static final String EXTRA_ID = "sos_id";
    public static final String EXTRA_NAME = "sos_name";
    public static final String EXTRA_UID = "sos_uid";
    public static final String EXTRA_LAT = "sos_lat";
    public static final String EXTRA_LNG = "sos_lng";
    public static final String EXTRA_AGE_MS = "sos_age_ms";
    public static final String EXTRA_POSTED_AT = "sos_posted_at";
    public static final String EXTRA_TIMESTAMP = "sos_timestamp";
    public static final String EXTRA_KEY = "sos_key";
    private static final String PREFS = "locus_sos_launch";
    private static final String PREF_KEY = "key";

    // True while this launch is showing over the lock screen, so acknowledging can hand the phone back to it.
    private static volatile boolean overLock = false;

    private SosLaunch() {}

    /** The intent behind the notification. {@code postedAtMs} is this phone's clock when the alert was raised. */
    public static Intent intent(Context context, SosAlert alert, long postedAtMs) {
        Intent intent = new Intent(context, MainActivity.class)
            .setAction(ACTION_OPEN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_ID, alert.id)
            .putExtra(EXTRA_UID, alert.senderUid)
            .putExtra(EXTRA_AGE_MS, alert.ageMs)
            .putExtra(EXTRA_POSTED_AT, postedAtMs)
            .putExtra(EXTRA_TIMESTAMP, alert.timestamp)
            .putExtra(EXTRA_KEY, launchKey(context));
        if (alert.senderName != null) intent.putExtra(EXTRA_NAME, alert.senderName);
        if (alert.hasLocation()) {
            intent.putExtra(EXTRA_LAT, alert.lat);
            intent.putExtra(EXTRA_LNG, alert.lng);
        }
        return intent;
    }

    /**
     * Whether {@code intent} is an SOS launch LOCUS itself made. MainActivity has to be exported (it
     * is the launcher), so any app on the phone can start it with this action and a made-up alert:
     * that used to light the screen over the lock screen and sound the alarm. Only an intent that
     * carries this install's launch key, kept in LOCUS's private storage where no other app can read
     * it, counts as an SOS. Anything else opens the app as an ordinary start would.
     */
    public static boolean isSosIntent(Context context, Intent intent) {
        if (intent == null || !ACTION_OPEN.equals(intent.getAction()) || intent.getStringExtra(EXTRA_ID) == null) return false;
        String key = intent.getStringExtra(EXTRA_KEY);
        return key != null && MessageDigest.isEqual(
            key.getBytes(StandardCharsets.UTF_8), launchKey(context).getBytes(StandardCharsets.UTF_8));
    }

    /** A random key, made once per install the first time it is needed. */
    private static synchronized String launchKey(Context context) {
        SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String key = prefs.getString(PREF_KEY, null);
        if (key == null) {
            byte[] bytes = new byte[16];
            new SecureRandom().nextBytes(bytes);
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) hex.append(String.format("%02x", b));
            key = hex.toString();
            // Written before any notification can carry it, so a tap after a restart still matches.
            prefs.edit().putString(PREF_KEY, key).commit();
        }
        return key;
    }

    /**
     * Called by MainActivity for every intent it gets. Only an SOS launch lets the app appear over
     * the lock screen and light the screen, like an incoming call, and only for as long as that
     * launch is on screen (see {@link #releaseWindow}); an ordinary start of LOCUS never does.
     * The phone is not unlocked: whoever picks it up still has to.
     */
    public static void prepareWindow(Activity activity, Intent intent) {
        if (!isSosIntent(activity, intent)) return;
        overLock = isLocked(activity);
        if (Build.VERSION.SDK_INT >= 27) {
            activity.setShowWhenLocked(true);
            activity.setTurnScreenOn(true);
        } else {
            activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    private static boolean isLocked(Context context) {
        KeyguardManager keyguard = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        return keyguard != null && keyguard.isKeyguardLocked();
    }

    /**
     * The person has dealt with the SOS they were shown over the lock screen. If the phone is still
     * locked, LOCUS leaves the screen and the lock screen is back: the SOS alert was let over it like
     * an incoming call, and the rest of the app (the Group, where everyone is) must not be reachable
     * from there without unlocking. Unlocked in the meantime, nothing happens.
     */
    public static void leaveIfStillLocked(Activity activity) {
        if (activity == null || !overLock) return;
        if (isLocked(activity)) activity.finishAndRemoveTask();
        overLock = false;
    }

    /** The app has left the screen: back to the ordinary rule (hidden behind the lock screen). */
    public static void releaseWindow(Activity activity) {
        overLock = false;
        if (Build.VERSION.SDK_INT >= 27) {
            activity.setShowWhenLocked(false);
            activity.setTurnScreenOn(false);
        } else {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }
}
