package com.locus.app.sharing;

import java.util.Map;

/**
 * How many people are waiting to join the Group, as the server tells its main admin and moderators
 * on the closed-app SOS route (GET /api/background/sos with joinAfter, backend/backgroundSharing.js):
 * the {@code join} field, { rev, count }. A new rev means the number changed (a burst of requests,
 * gathered for 20 s, or nobody waiting any more). Immutable.
 */
public final class JoinNotice {
    /** More than this is shown as this: the notification has room for a number, not a ledger. */
    static final int MAX_COUNT = 999;

    public final long rev;
    public final int count;

    public JoinNotice(long rev, int count) {
        this.rev = rev;
        this.count = count;
    }

    /** @return the answer's join field, or null when it has none (or it is not one) */
    public static JoinNotice parse(String body) {
        try {
            Object root = MiniJson.parse(body);
            if (!(root instanceof Map)) return null;
            Object join = ((Map<?, ?>) root).get("join");
            if (!(join instanceof Map)) return null;
            Object rev = ((Map<?, ?>) join).get("rev");
            Object count = ((Map<?, ?>) join).get("count");
            if (!(rev instanceof Double) || !(count instanceof Double)) return null;
            double r = (Double) rev;
            double c = (Double) count;
            if (!(r >= 1 && r < 9.0e15) || !(c >= 0)) return null;
            return new JoinNotice((long) r, (int) Math.min(MAX_COUNT, c));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
