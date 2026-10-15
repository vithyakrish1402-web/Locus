package com.locus.app.sharing;

/**
 * How long the server may be unreachable before the service gives up. Pure.
 *
 * A free server instance takes about a minute to boot after a restart or a deploy, and Render may
 * restart one at any time, so reports that fail with no answer, a 502 or a 503 are retried (see
 * Backoff: 2 s, 4 s, 8 s ... up to 5 minutes) for at least {@link #GIVE_UP_AFTER_MS}, not abandoned at
 * the first failure. Even then it does not vanish: the service posts a notice (see ReasonNotice).
 * Any answer from the server at all, even a refusal, means it is reachable again and starts the
 * clock over.
 */
public final class OutageTracker {
    /** Ten minutes: several times a cold start, comfortably more than the 3 minutes the retries must cover. */
    public static final long GIVE_UP_AFTER_MS = 10 * 60 * 1000;

    private final long giveUpAfterMs;
    private long failingSince = -1;

    public OutageTracker(long giveUpAfterMs) {
        this.giveUpAfterMs = giveUpAfterMs;
    }

    /**
     * Records the outcome of a report.
     *
     * @param serverReachable false for no answer, a 502 or a 503; true for any other answer
     * @return true when the server has now been unreachable for the whole of the allowed time
     */
    public boolean observe(boolean serverReachable, long nowMs) {
        if (serverReachable) {
            failingSince = -1;
            return false;
        }
        if (failingSince < 0) failingSince = nowMs;
        return nowMs - failingSince >= giveUpAfterMs;
    }
}
