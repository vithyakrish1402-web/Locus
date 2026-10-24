package com.locus.app.sharing;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.locus.app.MainActivity;
import com.locus.app.alerts.AlertPrefs;

/** Phone notifications for ordinary pings; the person's in-app DND remains respected. */
public final class PingNotifications {
    public static void show(Context context, PingNotice ping) {
        boolean silent = AlertPrefs.inAppDnd(context);
        String channelId = silent ? "locus_pings_silent_v1" : "locus_pings_v1";
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(channelId, silent ? "Pings (Do Not Disturb)" : "Group pings",
                silent ? NotificationManager.IMPORTANCE_LOW : NotificationManager.IMPORTANCE_HIGH);
            if (silent) { channel.setSound(null, null); channel.enableVibration(false); }
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(context, MainActivity.class).setAction(JoinNotifications.ACTION_OPEN_GROUP)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 7700, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        try {
            manager.notify(7700, new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(ping.senderName + " pinged you")
                .setContentText("Tap to open your group")
                .setPriority(silent ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH)
                .setSilent(silent).setAutoCancel(true).setContentIntent(tap).build());
        } catch (SecurityException ignored) { /* Android notification permission is off. */ }
    }
}
