package com.locus.app.sharing;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.locus.app.MainActivity;

/**
 * "3 people waiting to join", for the Group's main admin and moderators while LOCUS is closed
 * (JoinNotice, heard by the SOS listener). One notification, replaced in place as the number
 * changes, never stacked; gone when nobody is waiting. Its own channel, apart from SOS: an ordinary
 * heads-up notification with the phone's usual sound, nothing like an alarm. Tapping it opens LOCUS
 * on the Group tab, where the requests are (the LocusBackground plugin's "groupOpened").
 */
public final class JoinNotifications {
    /** Its own channel; settings are fixed once created, so change the id to change them. */
    public static final String CHANNEL_ID = "locus_join_requests_v1";
    /** Clear of the sharing (7401-7403) and SOS (7500..) notifications. */
    public static final int NOTIFICATION_ID = 7600;
    public static final String ACTION_OPEN_GROUP = "com.locus.app.group.OPEN";

    private JoinNotifications() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Join requests", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("People asking to join a Group you lead or moderate");
        channel.setShowBadge(true);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    /** "1 person waiting to join" / "N people waiting to join" (copy/notices.js NOTICES.joinWaiting). */
    static String title(int count) {
        return count == 1 ? "1 person waiting to join" : count + " people waiting to join";
    }

    static String text(String groupName) {
        return groupName == null || groupName.isEmpty() ? "Tap to let them in" : "Tap to let them in to " + groupName;
    }

    public static boolean isGroupIntent(Intent intent) {
        return intent != null && ACTION_OPEN_GROUP.equals(intent.getAction());
    }

    /** Shows the number waiting, or takes the notification down when it is 0. */
    public static void show(Context context, int count, String groupName) {
        if (count <= 0) {
            cancel(context);
            return;
        }
        ensureChannel(context);
        Intent open = new Intent(context, MainActivity.class)
            .setAction(ACTION_OPEN_GROUP)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, NOTIFICATION_ID, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_add)
            .setContentTitle(title(count))
            .setContentText(text(groupName))
            .setNumber(count)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build();
        try {
            context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
        } catch (RuntimeException e) {
            // Notifications are not allowed: nothing can be shown.
        }
    }

    public static void cancel(Context context) {
        context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
    }
}
