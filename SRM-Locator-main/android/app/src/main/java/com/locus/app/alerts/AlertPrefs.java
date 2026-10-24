package com.locus.app.alerts;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The person's alert choices, on this phone, readable from native code without the app running:
 * LOCUS's own Do Not Disturb (pings arrive silently, without sound or vibration; an SOS still
 * rings) and the alarm volume an alert plays at. The app writes them (AlertSoundPlugin); a
 * native ping notification (raised while the app is closed) must read {@link #inAppDnd} before
 * making a sound.
 */
public final class AlertPrefs {
    private static final String FILE = "locus_alert_prefs";
    private static final String KEY_DND = "in_app_dnd";
    private static final String KEY_FRACTION = "volume_fraction";

    private AlertPrefs() {}

    public static boolean inAppDnd(Context context) {
        return prefs(context).getBoolean(KEY_DND, false);
    }

    public static void setInAppDnd(Context context, boolean on) {
        prefs(context).edit().putBoolean(KEY_DND, on).apply();
    }

    public static double volumeFraction(Context context) {
        return prefs(context).getFloat(KEY_FRACTION, (float) AlertVolume.ALERT_ALARM_VOLUME_FRACTION);
    }

    public static void setVolumeFraction(Context context, double fraction) {
        if (Double.isNaN(fraction)) return;
        prefs(context).edit().putFloat(KEY_FRACTION, (float) Math.max(0.0, Math.min(1.0, fraction))).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
