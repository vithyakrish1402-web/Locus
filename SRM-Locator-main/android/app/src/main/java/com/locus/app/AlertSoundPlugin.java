package com.locus.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.locus.app.alerts.AlertChannels;
import com.locus.app.alerts.AlertPrefs;
import com.locus.app.alerts.AlertVolume;
import com.locus.app.alerts.AlertVolumeLedger;
import com.locus.app.sharing.LocationShareService;
import com.locus.app.sharing.SosNotifications;

/**
 * Alert sounds at full volume (src/utils/alertSound.js is the JavaScript side).
 *
 * The app's own SOS klaxon and ping blip used to be Web Audio in the WebView, which plays on the
 * media stream: quiet at a low media volume, and silent with the media volume down. Here they
 * play on the ALARM stream with the alarm volume raised (AlertVolume), which silent mode does not
 * mute and Do Not Disturb lets through by default ("alarms"). The volume goes back when the sound
 * stops, and on the app's next start if it was killed while ringing.
 *
 *   play({ kind: 'sos' | 'ping', volumeFraction? })  the SOS loops until stop(); a ping plays once
 *   stop()                                          the SOS klaxon stops, the volume goes back
 *   setInAppDnd({ on })                             LOCUS's own Do Not Disturb, for native code to read
 *   getDndAccess() -> { granted }                   whether alerts may bypass the phone's Do Not Disturb
 *   openDndAccessSettings()                         the system screen where that is given
 *   ensureChannels()                                re-applies the alert channels (after access is given)
 *
 * Every method answers; none throws to JavaScript for a sound that could not play: the app then
 * falls back to its Web Audio sound.
 */
@CapacitorPlugin(name = "AlertSound")
public class AlertSoundPlugin extends Plugin {
    private static final String HOLD_SOS = AlertVolumeLedger.APP + "sos";
    private static final String HOLD_PING = AlertVolumeLedger.APP + "ping";

    private MediaPlayer sos;
    private MediaPlayer ping;

    @Override
    public void load() {
        // A new process: anything the app's previous one held the volume up for is over.
        AlertVolume.releaseAll(getContext(), AlertVolumeLedger.APP);
        // So is anything the sharing service held it up for, unless that service is running now (in
        // this process). A force-stop during a background SOS used to leave the alarm stream at full
        // volume until sharing was next turned on, since only a new service released its own.
        if (!LocationShareService.isRunning()) AlertVolume.releaseAll(getContext(), AlertVolumeLedger.SERVICE);
        ensureAllChannels();
    }

    @Override
    protected void handleOnResume() {
        // Do Not Disturb access may have just been given in the system's settings.
        ensureAllChannels();
    }

    @Override
    protected void handleOnDestroy() {
        stopSos();
        stopPing();
    }

    @PluginMethod
    public void play(PluginCall call) {
        String kind = call.getString("kind", "");
        Double fraction = call.getDouble("volumeFraction");
        if (fraction != null) AlertPrefs.setVolumeFraction(getContext(), fraction);
        boolean isSos = "sos".equals(kind);
        if (!isSos && !"ping".equals(kind)) {
            call.reject("unknown kind");
            return;
        }
        if (isSos) {
            if (sos != null) { call.resolve(result(true)); return; } // already ringing
            sos = start(R.raw.locus_klaxon, true, HOLD_SOS);
            call.resolve(result(sos != null));
        } else {
            stopPing();
            ping = start(R.raw.locus_ping, false, HOLD_PING);
            call.resolve(result(ping != null));
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopSos();
        call.resolve();
    }

    @PluginMethod
    public void setInAppDnd(PluginCall call) {
        AlertPrefs.setInAppDnd(getContext(), Boolean.TRUE.equals(call.getBoolean("on", false)));
        call.resolve();
    }

    @PluginMethod
    public void getDndAccess(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("granted", AlertChannels.dndAccessGranted(getContext()));
        call.resolve(answer);
    }

    @PluginMethod
    public void openDndAccessSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 23) { call.resolve(); return; }
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("no settings screen");
        }
    }

    @PluginMethod
    public void ensureChannels(PluginCall call) {
        ensureAllChannels();
        call.resolve();
    }

    private void ensureAllChannels() {
        try {
            AlertChannels.ensure(getContext());
            SosNotifications.ensureChannel(getContext());
        } catch (RuntimeException e) {
            // A channel that cannot be made now is made again next time.
        }
    }

    /** Plays a raw sound on the alarm stream with the volume held up. @return the player, or null */
    private MediaPlayer start(int resId, boolean loop, String holder) {
        AlertVolume.raise(getContext(), holder);
        MediaPlayer player = new MediaPlayer();
        try {
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            android.content.res.AssetFileDescriptor file = getContext().getResources().openRawResourceFd(resId);
            player.setDataSource(file.getFileDescriptor(), file.getStartOffset(), file.getLength());
            file.close();
            player.setLooping(loop);
            player.setOnCompletionListener((mp) -> { if (!loop) stopPing(); });
            player.setOnErrorListener((mp, what, extra) -> {
                if (loop) stopSos(); else stopPing();
                return true;
            });
            player.prepare();
            player.start();
            return player;
        } catch (Exception e) {
            player.release();
            AlertVolume.release(getContext(), holder);
            return null;
        }
    }

    private void stopSos() {
        if (sos != null) {
            try { sos.stop(); } catch (IllegalStateException ignored) { }
            sos.release();
            sos = null;
        }
        AlertVolume.release(getContext(), HOLD_SOS);
    }

    private void stopPing() {
        if (ping != null) {
            try { ping.stop(); } catch (IllegalStateException ignored) { }
            ping.release();
            ping = null;
        }
        AlertVolume.release(getContext(), HOLD_PING);
    }

    private static JSObject result(boolean playing) {
        JSObject answer = new JSObject();
        answer.put("playing", playing);
        return answer;
    }
}
