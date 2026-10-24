package com.locus.app.alerts;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;

import java.util.HashSet;
import java.util.Set;

/**
 * Turns the phone's ALARM volume up for an SOS or a ping, and back down afterwards, whatever
 * the media or ringer volume is and in silent mode (the alarm stream is not muted by silent mode).
 *
 * The bookkeeping (who holds it up, the volume to put back) is {@link AlertVolumeLedger}, kept in
 * preferences so it survives the process: if LOCUS is killed while an alert rings, the saved
 * volume is put back the next time the app or the service starts ({@link #releaseAll}). A swiped
 * away notification puts it back through {@link AlertVolumeReceiver}.
 *
 * Changing a stream's volume can be refused (some phones, under Do Not Disturb): that is caught,
 * and the alert then plays at whatever the alarm volume already is, the loudest allowed.
 */
public final class AlertVolume {
    /** The alarm volume an alert plays at, as a fraction of the maximum. The app can set its own (AlertPrefs). */
    public static final double ALERT_ALARM_VOLUME_FRACTION = 1.0;

    private static final String FILE = "locus_alert_volume";
    private static final String KEY_HOLDERS = "holders";
    private static final String KEY_SAVED = "saved";
    private static final Object LOCK = new Object();

    private AlertVolume() {}

    /** {@code holder} needs the alarm loud: saves the volume as it is (the first holder) and raises it. */
    public static void raise(Context context, String holder) {
        synchronized (LOCK) {
            AudioManager audio = audio(context);
            if (audio == null) return;
            AlertVolumeLedger ledger = load(context);
            int current = audio.getStreamVolume(AudioManager.STREAM_ALARM);
            ledger.hold(holder, current);
            save(context, ledger);
            int target = AlertVolumeLedger.targetVolume(audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), AlertPrefs.volumeFraction(context));
            if (current < target) setAlarm(audio, target);
        }
    }

    /** {@code holder} is done: the volume goes back when it was the last one. */
    public static void release(Context context, String holder) {
        synchronized (LOCK) {
            AlertVolumeLedger ledger = load(context);
            int restore = ledger.release(holder);
            save(context, ledger);
            if (restore >= 0) setAlarm(audio(context), restore);
        }
    }

    /** Every holder starting with {@code prefix} is gone (their process restarted, or stopped). */
    public static void releaseAll(Context context, String prefix) {
        synchronized (LOCK) {
            AlertVolumeLedger ledger = load(context);
            int restore = ledger.releaseAll(prefix);
            save(context, ledger);
            if (restore >= 0) setAlarm(audio(context), restore);
        }
    }

    private static void setAlarm(AudioManager audio, int volume) {
        if (audio == null) return;
        try {
            audio.setStreamVolume(AudioManager.STREAM_ALARM, volume, 0);
        } catch (SecurityException e) {
            // Not allowed here (Do Not Disturb on some phones): the alert plays at the volume it has.
        }
    }

    private static AudioManager audio(Context context) {
        return context.getApplicationContext().getSystemService(AudioManager.class);
    }

    private static AlertVolumeLedger load(Context context) {
        SharedPreferences prefs = prefs(context);
        Set<String> holders = prefs.getStringSet(KEY_HOLDERS, null);
        return new AlertVolumeLedger(holders == null ? null : new HashSet<>(holders), prefs.getInt(KEY_SAVED, -1));
    }

    private static void save(Context context, AlertVolumeLedger ledger) {
        // commit, not apply: a kill right after must still find what was saved.
        prefs(context).edit()
            .putStringSet(KEY_HOLDERS, new HashSet<>(ledger.holders()))
            .putInt(KEY_SAVED, ledger.savedVolume())
            .commit();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
