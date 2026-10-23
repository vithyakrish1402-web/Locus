package com.locus.app.sharing;

import java.util.List;

/**
 * Turns the server's answer to "any SOS?" into what the listener does next. Pure.
 *
 *   200, understood      deliver what it holds, ask again from its rev straight away
 *   200, not understood  a garbled or cut-off answer: wait a backoff, ask again from the same rev
 *   no answer, 5xx       wait a backoff (2 s up to 30 s), ask again
 *   429                  wait as the server says (Retry-After), else half a minute
 *   401, 403, 410        the pass, the membership or the Group is not good right now. The location
 *                        reports end sharing for good when that is really so; the listener just
 *                        waits the longest backoff and asks again, so it also recovers from a
 *                        blip (a renewed pass) without anyone restarting it
 *   404, other 4xx       this server does not do this: stop listening until the service restarts
 */
public final class SosPollHandler {
    public static final class Next {
        public enum Action { DELIVER, WAIT, STOP }

        public final Action action;
        public final List<SosAlert> alerts; // DELIVER only
        public final long rev; // DELIVER only: ask from here next
        public final long delayMs; // WAIT only

        private Next(Action action, List<SosAlert> alerts, long rev, long delayMs) {
            this.action = action;
            this.alerts = alerts;
            this.rev = rev;
            this.delayMs = delayMs;
        }
    }

    /** What to wait after a refusal that may pass. */
    static final long REFUSED_WAIT_MS = 30_000;

    private SosPollHandler() {}

    public static Next forPoll(HttpResult r, Backoff backoff) {
        if (r.networkError || r.status == 0) return holdOff(backoff.next());
        int s = r.status;
        if (s == 200) {
            SosAlert.Poll poll = SosAlert.parsePoll(r.body);
            if (poll == null) return holdOff(backoff.next());
            backoff.reset();
            return new Next(Next.Action.DELIVER, poll.alerts, poll.rev, 0);
        }
        if (s == 429) return holdOff(Backoff.retryAfterMs(r.retryAfterSec > 0 ? r.retryAfterSec : 30));
        if (s == 401 || s == 403 || s == 410) return holdOff(REFUSED_WAIT_MS);
        if (s >= 500) return holdOff(backoff.next());
        return new Next(Next.Action.STOP, null, 0, 0);
    }

    private static Next holdOff(long delayMs) {
        return new Next(Next.Action.WAIT, null, 0, delayMs);
    }
}
