package com.locus.app.sharing;

/**
 * Decides when the service reports, and from which fix. Pure: the caller passes the time, so every
 * situation below can be run on a fake clock in a JVM test.
 *
 * WHO REPORTS FRESH GPS, in each situation. "Live" means the app is in the foreground with its
 * JavaScript running. The WebView freezes its timers and socket the moment the activity is PAUSED
 * (Capacitor's BridgeActivity.onPause), not when it is swiped away, so "live" follows the
 * activity's onResume and onPause, which are native callbacks and still fire when JavaScript has
 * stopped.
 *
 *   App on screen            live. The app's own socket is the source; the service is a backstop
 *                            and sends only a light heartbeat every 30 s.
 *   Home button pressed      onPause: not live. At once the service asks for fresh fixes at the
 *                            full rate and reports the first fix taken after that moment.
 *   Screen off, not swiped   the same onPause: the same.
 *   Split screen / a dialog  the app is paused, though still partly on screen: the same, because
 *   over the app             JavaScript is frozen all the same.
 *   App swiped away          nothing new happens: it was already not live since the Home press or
 *                            screen-off, and the service simply carries on at the full rate.
 *   Back in the app          onResume: live again, heartbeat only.
 *
 * FRESH AFTER THE SWITCH. The last fix may be up to a heartbeat (30 s) old when the app is left,
 * so right after the switch the planner will not report it as where the person is now. It waits for
 * a fix taken after the switch, for at most {@link #FRESH_WAIT_MS}; if none comes by then it
 * reports the held fix (if still reasonably recent) rather than go silent.
 */
public final class ReportPlanner {
    /** How long after leaving the app to wait for a fresh fix before reporting the one already held. */
    public static final long FRESH_WAIT_MS = 10_000;
    /** A fix older than this (or three report intervals, if longer) is never reported as current. */
    public static final long STALE_FLOOR_MS = 60_000;

    /** What to do now. */
    public static final class Plan {
        public final boolean post;
        public final Fix fix;
        public final long gapMs;
        /** True while the planner is holding back a report until a fresh fix arrives. */
        public final boolean waitingForFreshFix;

        Plan(boolean post, Fix fix, long gapMs, boolean waitingForFreshFix) {
            this.post = post;
            this.fix = fix;
            this.gapMs = gapMs;
            this.waitingForFreshFix = waitingForFreshFix;
        }
    }

    private static final Plan NOTHING = new Plan(false, null, 0, false);

    /** "Never reported / report as soon as there is something to say": far enough back that any gap has passed. */
    private static final long NEVER = Long.MIN_VALUE / 2;

    private AdaptiveRate rate;
    private boolean live;
    private Fix lastFix;
    private long lastPostAt = NEVER;
    private long nextAllowedAt = 0;
    private long freshAfterMs = 0; // 0 = no fresh fix is being waited for

    public ReportPlanner(AdaptiveRate rate, boolean live) {
        this.rate = rate;
        this.live = live;
    }

    public void setRate(AdaptiveRate newRate) {
        this.rate = newRate;
    }

    public boolean isLive() {
        return live;
    }

    public Fix lastFix() {
        return lastFix;
    }

    /** The app has gone to, or come back from, the foreground. Idempotent. */
    public void setLive(boolean nowLive, long nowMs) {
        if (nowLive == live) return;
        live = nowLive;
        if (nowLive) {
            freshAfterMs = 0; // back in the app: its socket is the source again
        } else {
            lastPostAt = NEVER; // report as soon as there is a fresh fix
            freshAfterMs = nowMs;
        }
    }

    /** A fix arrived from the phone. */
    public void onFix(Fix fix) {
        lastFix = fix;
        rate.onFix(fix.speedMps);
    }

    /** Report at the next opportunity (sharing just began, was resumed, or was paused). */
    public void reportSoon() {
        lastPostAt = NEVER;
    }

    /** A report was sent at {@code nowMs}. (The fresh-fix wait needs no clearing: every later fix is newer than the switch.) */
    public void onPosted(long nowMs) {
        lastPostAt = nowMs;
    }

    /** The report failed and should be tried again no sooner than {@code delayMs} from now. */
    public void holdOff(long nowMs, long delayMs) {
        nextAllowedAt = nowMs + delayMs;
        lastPostAt = NEVER;
    }

    /** How often to ask the phone for fixes right now. */
    public long requestIntervalMs(int batteryPct) {
        return rate.intervalMs(live, batteryPct);
    }

    public Plan plan(long nowMs, boolean paused, Fix held, int batteryPct) {
        if (nowMs < nextAllowedAt) return NOTHING;
        long gap = paused ? PauseState.PAUSE_HEARTBEAT_MS : rate.intervalMs(live, batteryPct);
        if (nowMs - lastPostAt < gap * 9 / 10) return NOTHING;
        Fix fix = paused ? held : lastFix;
        if (fix == null) return NOTHING; // nothing to say yet; better silent than wrong
        if (!paused) {
            if (freshAfterMs > 0 && fix.takenAtMs < freshAfterMs && nowMs - freshAfterMs < FRESH_WAIT_MS) {
                return new Plan(false, null, gap, true); // wait for a fix taken since leaving the app
            }
            // A position that is old is not reported as where they are now: the lease is allowed to run out.
            if (nowMs - fix.takenAtMs > Math.max(gap * 3, STALE_FLOOR_MS)) return NOTHING;
        }
        return new Plan(true, fix, gap, false);
    }
}
