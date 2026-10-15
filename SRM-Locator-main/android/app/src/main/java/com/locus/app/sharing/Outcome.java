package com.locus.app.sharing;

/** What to do after a report was answered (or not). */
public final class Outcome {
    public enum Action {
        /** It went through. */
        CONTINUE,
        /** Try again later: wait {@link #delayMs}. */
        RETRY,
        /** This report was refused as it stands; do not resend it, carry on with the next. */
        DROP,
        /** Sharing cannot go on; stop and say why ({@link #stopReason}). */
        STOP
    }

    public final Action action;
    public final long delayMs;
    public final String stopReason;
    /** True when this failure means the SERVER could not be reached (no answer, 502, 503, 504), as opposed to it answering. */
    public final boolean serverUnreachable;

    Outcome(Action action, long delayMs, String stopReason, boolean serverUnreachable) {
        this.action = action;
        this.delayMs = delayMs;
        this.stopReason = stopReason;
        this.serverUnreachable = serverUnreachable;
    }
}
