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

    Outcome(Action action, long delayMs, String stopReason) {
        this.action = action;
        this.delayMs = delayMs;
        this.stopReason = stopReason;
    }
}
