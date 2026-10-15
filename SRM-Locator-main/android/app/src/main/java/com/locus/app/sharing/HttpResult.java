package com.locus.app.sharing;

/** What came back from the server, or that nothing did. */
public final class HttpResult {
    public final int status; // 0 when there was no answer at all
    public final String body; // at most a few KB; may be empty
    public final long retryAfterSec; // 0 when not given
    public final boolean networkError;

    public HttpResult(int status, String body, long retryAfterSec, boolean networkError) {
        this.status = status;
        this.body = body == null ? "" : body;
        this.retryAfterSec = retryAfterSec;
        this.networkError = networkError;
    }

    public static HttpResult noAnswer() {
        return new HttpResult(0, "", 0, true);
    }
}
