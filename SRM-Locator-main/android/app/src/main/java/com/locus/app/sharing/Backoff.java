package com.locus.app.sharing;

import java.util.function.DoubleSupplier;

/**
 * How long to wait after a failed report: 2 s, 4 s, 8 s ... up to 5 minutes, each with up to
 * 20% jitter either way so a lot of phones coming back together do not arrive together. A
 * success starts it over. A server that says when to come back (Retry-After) is obeyed instead.
 */
public final class Backoff {
    public static final long BASE_MS = 2_000;
    public static final long CAP_MS = 300_000;
    public static final double JITTER = 0.2;

    private final DoubleSupplier random; // 0 (inclusive) to 1 (exclusive)
    private final long baseMs;
    private final long capMs;
    private int failures = 0;

    public Backoff(DoubleSupplier random) {
        this(random, BASE_MS, CAP_MS);
    }

    /** The same doubling with its own start and ceiling (the SOS listener's is 2 s up to 30 s). */
    public Backoff(DoubleSupplier random, long baseMs, long capMs) {
        this.random = random;
        this.baseMs = baseMs;
        this.capMs = capMs;
    }

    /** The wait after another failure. */
    public long next() {
        long raw = baseMs;
        for (int i = 0; i < failures && raw < capMs; i++) raw *= 2;
        raw = Math.min(raw, capMs);
        failures = Math.min(failures + 1, 30);
        double factor = 1 + JITTER * (2 * random.getAsDouble() - 1);
        return Math.max(baseMs / 2, Math.round(raw * factor));
    }

    public void reset() {
        failures = 0;
    }

    /** What the server asked for, in seconds, bounded to something sensible. */
    public static long retryAfterMs(long seconds) {
        return Math.max(1_000, Math.min(seconds, 900) * 1_000);
    }
}
