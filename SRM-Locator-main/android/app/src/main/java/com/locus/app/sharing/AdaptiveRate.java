package com.locus.app.sharing;

/**
 * How often the service reports, and what it tells the server about its next report.
 *
 * The base is the Settings choice the app already has (15 s, 5 s or 1 s: "Location refresh
 * rate"), not a second setting. From it:
 *  - standing still (three fixes in a row under {@link #STATIONARY_MPS}) reports three times
 *    less often, and moving again snaps straight back;
 *  - a low battery (15% or less) reports half as often;
 *  - never less often than {@link #MAX_INTERVAL_MS}, so a phone that is quietly sharing is
 *    never quiet for long.
 * While the app is on screen the service is only a backstop for the app's own connection, so it
 * reports at {@link #VISIBLE_HEARTBEAT_MS} whatever the above says.
 *
 * {@link #nextPostWithinSec} is what each report promises: the server holds the person's place
 * for three times that. Pure logic: no Android, no clock.
 */
public final class AdaptiveRate {
    public static final long MIN_INTERVAL_MS = 1_000;
    public static final long MAX_INTERVAL_MS = 120_000;
    public static final long VISIBLE_HEARTBEAT_MS = 30_000;
    public static final double STATIONARY_MPS = 0.5;
    public static final int STATIONARY_FIXES = 3;
    public static final int LOW_BATTERY_PCT = 15;
    /** What the server accepts for nextPostWithinSec. */
    static final int MIN_NEXT_SEC = 1;
    static final int MAX_NEXT_SEC = 300;

    private final long baseMs;
    private int slowFixesInARow = 0;

    public AdaptiveRate(long pollingMs) {
        this.baseMs = clamp(pollingMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
    }

    /** Feed every fix. A fix with no speed says nothing either way. */
    public void onFix(double speedMps) {
        if (Double.isNaN(speedMps) || speedMps < 0) return;
        slowFixesInARow = speedMps < STATIONARY_MPS ? Math.min(slowFixesInARow + 1, STATIONARY_FIXES) : 0;
    }

    public boolean isStationary() {
        return slowFixesInARow >= STATIONARY_FIXES;
    }

    /** @param batteryPct 0-100, or negative when unknown */
    public long intervalMs(boolean appVisible, int batteryPct) {
        if (appVisible) return VISIBLE_HEARTBEAT_MS;
        long interval = baseMs;
        if (isStationary()) interval *= 3;
        if (batteryPct >= 0 && batteryPct <= LOW_BATTERY_PCT) interval *= 2;
        return clamp(interval, baseMs, MAX_INTERVAL_MS);
    }

    /** The promise sent with a report: whole seconds, rounded up, within what the server takes. */
    public static int nextPostWithinSec(long intervalMs) {
        long sec = (intervalMs + 999) / 1000;
        return (int) clamp(sec, MIN_NEXT_SEC, MAX_NEXT_SEC);
    }

    private static long clamp(long v, long lo, long hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
