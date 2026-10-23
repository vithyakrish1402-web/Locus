package com.locus.app.sharing;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.locus.app.alerts.AlertVolumeReceiver;

/**
 * The alert for an SOS heard while LOCUS is closed. Loud on purpose, and kept apart from the quiet
 * sharing notification: its own channel, so the person can still tune it in the phone's own
 * settings (sound, vibration, lock screen). It plays on the alarm stream, and the service holds the
 * alarm volume up while it rings (alerts/AlertVolume.java). The channel asks to bypass Do Not
 * Disturb; Android honours that only once the person has given LOCUS Do Not Disturb access (the
 * app explains and opens that screen), and the channel is re-applied when they have.
 *
 * Raised: highest importance, the alarm sound, a long strong vibration, visible on the lock screen
 * and, where the phone allows it, a full-screen alert like an incoming call that lights the screen.
 * Where Android 14+ has taken the full-screen right away, the same notification is a heads-up one,
 * which still rings, vibrates and shows on the lock screen (see {@link #fullScreenAllowed}).
 * One notification per sender (a slot), replaced in place when the same person sends again.
 */
public final class SosNotifications {
    /** The dedicated high-importance channel. Its settings are fixed once created: change the id to change them.
     *  v2 (2026-10) adds the Do Not Disturb bypass; the first one, without it, is deleted. */
    public static final String SOS_ALERT_CHANNEL_ID = "locus_sos_alert_v2";
    private static final String[] OLD_SOS_ALERT_CHANNEL_IDS = {"locus_sos_alert"};
    /** What holds the alarm volume up for the alert in a slot (alerts/AlertVolumeLedger.SERVICE + slot). */
    public static String volumeHolder(int slot) {
        return com.locus.app.alerts.AlertVolumeLedger.SERVICE + slot;
    }
    /** Long, strong and repeating, nothing like a ping: 0.9 s on, 0.25 s off, three times, then a pause. */
    public static final long[] SOS_VIBRATION_PATTERN = {0, 900, 250, 900, 250, 900, 1200};
    /** How long the sound goes on before it is quietened (the notification stays). */
    public static final long SOS_ALERT_AUTO_TIMEOUT_MS = 5 * 60 * 1000;
    /** Notification ids SOS_ID_BASE .. SOS_ID_BASE + SosLedger.SLOTS - 1, clear of the sharing notifications (7401-7403). */
    public static final int SOS_ID_BASE = 7500;

    private SosNotifications() {}

    private static NotificationManager manager(Context context) {
        return context.getSystemService(NotificationManager.class);
    }

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        Uri alarm = alarmSound();
        NotificationChannel channel = new NotificationChannel(SOS_ALERT_CHANNEL_ID, "SOS alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("A teammate in your Group sent an SOS");
        channel.setSound(alarm, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        channel.enableVibration(true);
        channel.setVibrationPattern(SOS_VIBRATION_PATTERN);
        channel.enableLights(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setShowBadge(true);
        channel.setBypassDnd(true);
        NotificationManager manager = manager(context);
        manager.createNotificationChannel(channel);
        for (String old : OLD_SOS_ALERT_CHANNEL_IDS) {
            if (manager.getNotificationChannel(old) != null) manager.deleteNotificationChannel(old);
        }
    }

    private static Uri alarmSound() {
        Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return uri != null ? uri : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
    }

    /** Whether the alert can ring at all: notifications allowed and this channel not switched off or turned down to silent. */
    public static boolean audible(Context context) {
        if (!androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        ensureChannel(context);
        NotificationChannel channel = manager(context).getNotificationChannel(SOS_ALERT_CHANNEL_ID);
        return channel != null && channel.getImportance() >= NotificationManager.IMPORTANCE_HIGH;
    }

    /** Android 14 lets the person (or the store) take the full-screen right away from an app. Earlier Androids grant it with the install. */
    public static boolean fullScreenAllowed(Context context) {
        if (Build.VERSION.SDK_INT >= 34) return manager(context).canUseFullScreenIntent();
        return true;
    }

    static String title(SosAlert alert) {
        String name = alert.senderName != null ? alert.senderName : "Someone in your group";
        return "SOS: " + name + " needs help";
    }

    /** Same words as the in-app alert (copy/emergency.js SOS_RECEIVED.age). */
    static String age(long ageMs) {
        long minutes = ageMs / 60_000;
        return minutes < 1 ? "Sent just now" : "Sent " + minutes + " min ago";
    }

    /**
     * Shows (or replaces) the alert in its slot.
     * @param loud true to ring, vibrate and raise the full-screen alert; false for a silent replacement
     *             (a second press from the same person, or the sound timing out)
     * @param postedAtMs this phone's clock when the alert arrived
     */
    public static void post(Context context, SosAlert alert, int slot, boolean loud, long postedAtMs) {
        ensureChannel(context);
        PendingIntent open = PendingIntent.getActivity(context, slot, SosLaunch.intent(context, alert, postedAtMs),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, SOS_ALERT_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title(alert))
            .setContentText(age(alert.ageMs + Math.max(0, System.currentTimeMillis() - postedAtMs)) + ". Tap to open LOCUS")
            .setSubText("Emergency alert")
            .setWhen(postedAtMs - alert.ageMs)
            .setShowWhen(true)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            // Swiped away: the alarm volume held up for it goes back (alerts/AlertVolumeReceiver).
            .setDeleteIntent(PendingIntent.getBroadcast(context, SOS_ID_BASE + slot,
                AlertVolumeReceiver.releaseIntent(context, volumeHolder(slot)),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .setAutoCancel(true)
            .setOnlyAlertOnce(!loud);
        if (loud) {
            builder.setDefaults(0)
                .setSound(alarmSound(), AudioManager.STREAM_ALARM) // before Android 8; later the channel decides
                .setVibrate(SOS_VIBRATION_PATTERN);
            // On Android 14+ without the right this is skipped, and the heads-up notification above stands in.
            if (fullScreenAllowed(context)) builder.setFullScreenIntent(open, true);
        } else {
            builder.setSilent(true);
        }
        Notification notification = builder.build();
        if (loud) notification.flags |= Notification.FLAG_INSISTENT; // keeps ringing until it is dealt with, or quietened
        try {
            manager(context).notify(SOS_ID_BASE + slot, notification);
        } catch (RuntimeException e) {
            // Notifications are not allowed: nothing can be shown, and nothing more can be done here.
        }
    }

    public static void cancel(Context context, int slot) {
        if (slot < 0) return;
        manager(context).cancel(SOS_ID_BASE + slot);
    }

    public static void cancelAll(Context context) {
        for (int slot = 0; slot < SosLedger.SLOTS; slot++) manager(context).cancel(SOS_ID_BASE + slot);
    }
}
