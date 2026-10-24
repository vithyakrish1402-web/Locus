package com.locus.app.alerts;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * An SOS notification swiped away (its delete intent): whatever held the alarm volume up for it
 * lets go, so the volume goes back even when nobody opens the app.
 */
public class AlertVolumeReceiver extends BroadcastReceiver {
    public static final String ACTION_RELEASE = "com.locus.app.alerts.RELEASE_ALARM_VOLUME";
    public static final String EXTRA_HOLDER = "holder";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_RELEASE.equals(intent.getAction())) return;
        String holder = intent.getStringExtra(EXTRA_HOLDER);
        if (holder != null) AlertVolume.release(context, holder);
    }

    public static Intent releaseIntent(Context context, String holder) {
        return new Intent(context, AlertVolumeReceiver.class).setAction(ACTION_RELEASE).putExtra(EXTRA_HOLDER, holder);
    }
}
