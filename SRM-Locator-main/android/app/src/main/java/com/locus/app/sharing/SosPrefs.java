package com.locus.app.sharing;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * "SOS alerts when the app is closed": on by default, off only when the person turns it off in
 * Settings. It only matters while background sharing is on, because the alerts are heard by the
 * sharing service: turn sharing off and they stop with it. Not a secret, so plain preferences.
 */
public final class SosPrefs {
    private static final String FILE = "locus_sos_alerts";
    private static final String KEY_ENABLED = "enabled";

    private SosPrefs() {}

    public static boolean enabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, true);
    }

    public static void setEnabled(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
