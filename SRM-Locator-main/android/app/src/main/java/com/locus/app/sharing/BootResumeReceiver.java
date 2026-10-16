package com.locus.app.sharing;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * After the phone restarts: if the person was sharing, say "Tap to resume sharing with <Group>".
 *
 * That is ALL it does. It never starts the location service: Android 14 and later do not allow a
 * location service to start by itself at boot, and this does not try to get around that. Tapping
 * the notice opens the app, which starts sharing afresh from the foreground, where it is allowed.
 *
 * It reads only the plain "resume hint" (when the pass runs out, and the Group's name). It never
 * opens the sealed token, so it cannot leak it and does not wake the Keystore.
 */
public class BootResumeReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        String group = SharingState.store(context).resumeHint(System.currentTimeMillis());
        if (group != null) SharingNotifications.postResume(context, group);
    }
}
