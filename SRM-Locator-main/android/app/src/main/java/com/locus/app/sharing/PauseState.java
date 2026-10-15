package com.locus.app.sharing;

/**
 * Pausing: the person stays on the Group's map at the position they paused at, shown as
 * "Paused", until the pause runs out or they resume. (Not stopping: that ends sharing.)
 *
 * A pause of 0 or less means until resumed. The service posts the held position as FROZEN at a
 * slow heartbeat while paused, so the server's lease (at most 15 minutes) never lapses.
 * Pure logic; the caller passes the time.
 */
public final class PauseState {
    public static final long PAUSE_HEARTBEAT_MS = 240_000;
    public static final long MAX_PAUSE_MS = 24L * 60 * 60 * 1000;

    private boolean paused = false;
    private long untilMs = 0; // 0 = until resumed
    private Fix held = null;

    /** @param durationMs how long, or 0 or less for until resumed (capped at a day) */
    public void pause(long durationMs, long nowMs, Fix position) {
        paused = true;
        untilMs = durationMs <= 0 ? 0 : nowMs + Math.min(durationMs, MAX_PAUSE_MS);
        held = position;
    }

    public void resume() {
        paused = false;
        untilMs = 0;
        held = null;
    }

    /** Whether it is paused at {@code nowMs}; a pause that has run out ends itself. */
    public boolean isPaused(long nowMs) {
        if (paused && untilMs != 0 && nowMs >= untilMs) resume();
        return paused;
    }

    /** The status word the server takes. */
    public String status(long nowMs) {
        return isPaused(nowMs) ? "FROZEN" : "ACTIVE";
    }

    /** The position the person paused at, or null (paused before any fix, or not paused). */
    public Fix held() {
        return held;
    }

    /** Milliseconds left, or -1 for until resumed or not paused. */
    public long remainingMs(long nowMs) {
        if (!isPaused(nowMs) || untilMs == 0) return -1;
        return untilMs - nowMs;
    }
}
