package com.locus.app.sharing;

/**
 * What the service does when Android restarts it by itself (START_STICKY, after it was killed)
 * rather than the app starting it. Pure.
 *
 * A restart is a background start. On Android 14 and later a location foreground service may
 * not be started from the background, or may find it has no location access. So a restart only
 * carries on if everything it needs is still in place; otherwise it does NOT crash and does NOT
 * try again in a loop: it posts "Tap to resume sharing with <Group>" and stops, leaving the
 * person to open the app (which starts sharing afresh, in the foreground, where it is allowed).
 */
public final class ServicePolicy {
    public enum Restart {
        /** All in place: carry on sharing. */
        CONTINUE,
        /** Cannot carry on; tell the person to tap to resume. */
        TELL_TO_RESUME,
        /** Nothing to resume and nothing to say. */
        STOP_QUIETLY
    }

    private ServicePolicy() {}

    public static Restart onSystemRestart(Session session, long nowMs, boolean notificationsEnabled, boolean locationGranted) {
        if (session == null) return Restart.STOP_QUIETLY;
        if (nowMs >= session.expiresAtMs) return Restart.STOP_QUIETLY; // the pass has run out; opening the app gets a new one
        if (!notificationsEnabled) return Restart.TELL_TO_RESUME; // never share where the person cannot see it
        if (!locationGranted) return Restart.TELL_TO_RESUME;
        // Whether the phone lets a location service start from the background is only known
        // when the service tries (LocationShareService.enterForeground), which then falls back
        // to the same notice.
        return Restart.CONTINUE;
    }
}
