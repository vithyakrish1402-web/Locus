package com.locus.app.alerts;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/**
 * The ping alert's notification channel, and Do Not Disturb access.
 *
 * A channel's sound, importance and Do Not Disturb setting are fixed once it exists, so a change
 * means a new id. The ping channel is new here (v1); the SOS channel moved to a new id for the same
 * reason (sharing/SosNotifications.java). Both play on the alarm stream (USAGE_ALARM) and ask to
 * bypass Do Not Disturb. Android only honours that ask for an app the person has given Do Not
 * Disturb access to, and only when the channel is created or updated while it has it: so
 * {@link #ensure} runs again whenever the app comes back to the front (AlertSoundPlugin).
 *
 * Nothing posts to the ping channel yet: it is for the ping notification raised while the app is
 * closed, which is being built separately. That code must check {@link AlertPrefs#inAppDnd}
 * first, and post silently when it is on.
 */
public final class AlertChannels {
    public static final String PING_CHANNEL_ID = "locus_ping_alert_v1";
    /** Short, two buzzes: unlike an SOS. */
    public static final long[] PING_VIBRATION_PATTERN = {0, 250, 150, 250};

    private AlertChannels() {}

    public static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        NotificationChannel ping = new NotificationChannel(PING_CHANNEL_ID, "Pings", NotificationManager.IMPORTANCE_HIGH);
        ping.setDescription("Someone in your Group pinged you");
        ping.setSound(sound, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        ping.enableVibration(true);
        ping.setVibrationPattern(PING_VIBRATION_PATTERN);
        ping.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ping.setBypassDnd(true);
        manager.createNotificationChannel(ping);
    }

    /** Whether the person has given LOCUS Do Not Disturb access (Settings > Do Not Disturb access). */
    public static boolean dndAccessGranted(Context context) {
        if (Build.VERSION.SDK_INT < 23) return true;
        return context.getSystemService(NotificationManager.class).isNotificationPolicyAccessGranted();
    }
}
