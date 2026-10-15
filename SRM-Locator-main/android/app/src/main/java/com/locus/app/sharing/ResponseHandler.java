package com.locus.app.sharing;

/**
 * Turns the server's answer to a location report into what the service does next. Pure.
 *
 *   200                  carry on (and the backoff starts over)
 *   no answer, 5xx       try again after a backoff
 *   429                  try again when the server says (Retry-After), else in a minute
 *   400, 413             this report was refused as it stands: drop it, send the next
 *   401                  the pass is finished (expired, revoked, replaced): stop
 *   403                  no longer a member of the Group (removed, blocked): stop
 *   410                  the Group is gone: stop
 *   503 "disabled"       the server has switched background sharing off: stop
 *   404, anything else   this server does not do this: stop
 * A stop is permanent; the person asks again (the app does) when the app is next opened.
 */
public final class ResponseHandler {
    public static final String REVOKED = "revoked";
    public static final String TOKEN_EXPIRED = "token-expired";
    public static final String FORBIDDEN = "forbidden";
    public static final String GROUP_GONE = "group-gone";
    public static final String DISABLED = "disabled";
    public static final String REJECTED = "rejected";

    private ResponseHandler() {}

    public static Outcome forLocation(HttpResult r, Backoff backoff) {
        if (r.networkError || r.status == 0) return retry(backoff.next());
        int s = r.status;
        if (s == 200) {
            backoff.reset();
            return new Outcome(Outcome.Action.CONTINUE, 0, null);
        }
        if (s == 429) return retry(Backoff.retryAfterMs(r.retryAfterSec > 0 ? r.retryAfterSec : 60));
        if (s == 400 || s == 413) return new Outcome(Outcome.Action.DROP, 0, null);
        if (s == 401) return stop(r.body.contains("\"expired\"") ? TOKEN_EXPIRED : REVOKED);
        if (s == 403) return stop(FORBIDDEN);
        if (s == 410) return stop(GROUP_GONE);
        if (s == 503 && r.body.contains("\"disabled\"")) return stop(DISABLED);
        if (s >= 500) return retry(backoff.next());
        return stop(REJECTED);
    }

    private static Outcome retry(long delayMs) {
        return new Outcome(Outcome.Action.RETRY, delayMs, null);
    }

    private static Outcome stop(String reason) {
        return new Outcome(Outcome.Action.STOP, 0, reason);
    }
}
