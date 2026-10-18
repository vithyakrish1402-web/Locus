package com.locus.app.sharing;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * The notifications of background sharing.
 *
 *  - The permanent one, in the quiet "Background Sharing" channel: it says plainly that the
 *    location is being shared and with which Group, and carries Pause 15 min, Pause 1 hour (or
 *    Resume) and Stop. It is also the person's proof that sharing is on, which is why sharing
 *    does not start where it cannot be shown (see {@link #canBeSeen}).
 *  - "Tap to resume sharing with ...", in its own channel at normal importance, for when
 *    Android has ended sharing and it cannot be started again from the background.
 *
 * TEMPORARY: the small icon is a system one until the design supplies a proper monochrome icon.
 */
public final class SharingNotifications {
    public static final String CHANNEL_SHARING = "bg_sharing";
    public static final String CHANNEL_RESUME = "bg_resume";
    public static final int SHARING_ID = 7401;
    public static final int RESUME_ID = 7402;
    public static final int ENDED_ID = 7403;

    private SharingNotifications() {}

    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel sharing = new NotificationChannel(CHANNEL_SHARING, "Background Sharing", NotificationManager.IMPORTANCE_LOW);
        sharing.setDescription("Shown while LOCUS is sharing your location with your Group");
        sharing.setShowBadge(false);
        sharing.setSound(null, null);
        sharing.enableVibration(false);
        manager.createNotificationChannel(sharing);
        NotificationChannel resume = new NotificationChannel(CHANNEL_RESUME, "Sharing reminders", NotificationManager.IMPORTANCE_DEFAULT);
        resume.setDescription("Asks you to tap to start sharing again after your phone stopped it");
        manager.createNotificationChannel(resume);
    }

    /**
     * Whether a notification posted now would actually be seen: notifications are allowed for the
     * app, and the Background Sharing channel has not been switched off.
     */
    public static boolean canBeSeen(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            ensureChannels(context);
            NotificationChannel channel = context.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL_SHARING);
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }

    private static PendingIntent openApp(Context context) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent();
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent serviceAction(Context context, int requestCode, String action, int minutes) {
        Intent intent = new Intent(context, LocationShareService.class).setAction(action).putExtra(LocationShareService.EXTRA_MINUTES, minutes);
        return PendingIntent.getService(context, requestCode, intent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** The permanent notification. {@code groupName} may be null before the session is known. */
    public static Notification sharing(Context context, String groupName, boolean paused) {
        String where = groupName == null || groupName.isEmpty() ? "your Group" : groupName;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_SHARING)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(paused ? "LOCUS sharing is paused" : "LOCUS is sharing your location")
            .setContentText(paused ? "Your Group sees where you paused. Group: " + where : "Sharing your location with " + where)
            .setContentIntent(openApp(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        if (paused) {
            builder.addAction(0, "Resume", serviceAction(context, 1, LocationShareService.ACTION_RESUME, 0));
        } else {
            builder.addAction(0, "Pause 15 min", serviceAction(context, 2, LocationShareService.ACTION_PAUSE, 15));
            builder.addAction(0, "Pause 1 hour", serviceAction(context, 3, LocationShareService.ACTION_PAUSE, 60));
        }
        builder.addAction(0, "Stop", serviceAction(context, 4, LocationShareService.ACTION_STOP, 0));
        return builder.build();
    }

    /** "Tap to resume sharing with ...". Tapping opens the app, which then starts sharing afresh. */
    public static void postResume(Context context, String groupName) {
        ensureChannels(context);
        String where = groupName == null || groupName.isEmpty() ? "your Group" : groupName;
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_RESUME)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("LOCUS stopped sharing your location")
            .setContentText("Tap to resume sharing with " + where)
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .build();
        try {
            context.getSystemService(NotificationManager.class).notify(RESUME_ID, notification);
        } catch (RuntimeException e) {
            // Notifications not allowed: nothing to show, and nothing to do about it here.
        }
    }

    public static void cancelResume(Context context) {
        context.getSystemService(NotificationManager.class).cancel(RESUME_ID);
    }

    /**
     * Said once when sharing ended and nobody asked it to ("Your Group ended", or the server could not
     * be reached for the whole retry window), so the notification does not just vanish. Tapping it
     * opens the app and removes it.
     */
    public static void postEnded(Context context, ReasonNotice.Kind kind) {
        if (kind == ReasonNotice.Kind.NONE) return;
        ensureChannels(context);
        boolean unreachable = kind == ReasonNotice.Kind.UNREACHABLE;
        boolean switchedOff = kind == ReasonNotice.Kind.DISABLED;
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_RESUME)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(switchedOff ? "Background sharing was switched off" : unreachable ? "LOCUS stopped sharing your location" : "Your Group ended")
            .setContentText(switchedOff ? "LOCUS no longer shares your location when it is closed. Tap to reopen LOCUS"
                : unreachable ? "The server could not be reached. Tap to reopen LOCUS" : "Tap to reopen LOCUS")
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .build();
        try {
            context.getSystemService(NotificationManager.class).notify(ENDED_ID, notification);
        } catch (RuntimeException e) {
            // Notifications not allowed: nothing to show.
        }
    }

    public static void cancelEnded(Context context) {
        context.getSystemService(NotificationManager.class).cancel(ENDED_ID);
    }
}
