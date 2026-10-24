package com.locus.app.sharing;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * One SOS as the server describes it to a phone listening from the background
 * (GET /api/background/sos, backend/backgroundSharing.js): who, where, how old, and the {@code rev}
 * that says which version of it this is (the same SOS pressed again has the same id and a newer rev).
 * Immutable. Nothing here is logged.
 */
public final class SosAlert {
    static final int MAX_NAME = 40;

    public final String id;
    public final String senderUid;
    /** What to call them: their name, or null when the server had none (the notification then says "Someone in your group"). */
    public final String senderName;
    public final double lat; // NaN when the alert came without a location
    public final double lng;
    public final long rev;
    /** How old the server said it was when it answered. */
    public final long ageMs;
    /** When it was sent, on the sender's clock (shown nowhere; kept for the app). */
    public final long timestamp;

    public SosAlert(String id, String senderUid, String senderName, double lat, double lng, long rev, long ageMs, long timestamp) {
        this.id = id;
        this.senderUid = senderUid;
        this.senderName = senderName;
        this.lat = lat;
        this.lng = lng;
        this.rev = rev;
        this.ageMs = ageMs;
        this.timestamp = timestamp;
    }

    public boolean hasLocation() {
        return !Double.isNaN(lat) && !Double.isNaN(lng);
    }

    /** The server's whole answer: the alerts it has for this person, and the rev to ask from next time. */
    public static final class Poll {
        public final List<SosAlert> alerts;
        public final long rev;

        Poll(List<SosAlert> alerts, long rev) {
            this.alerts = Collections.unmodifiableList(alerts);
            this.rev = rev;
        }
    }

    /** @return the answer, or null if the body is not one (cut off, garbled, not what was asked for) */
    public static Poll parsePoll(String body) {
        try {
            Object root = MiniJson.parse(body);
            if (!(root instanceof Map)) return null;
            Map<?, ?> map = (Map<?, ?>) root;
            Object revValue = map.get("rev");
            Object list = map.get("sos");
            if (!(list instanceof List) || !(revValue instanceof Double)) return null;
            long rev = whole(revValue, -1);
            if (rev < 0) return null;
            List<SosAlert> alerts = new ArrayList<>();
            for (Object item : (List<?>) list) {
                SosAlert alert = one(item);
                if (alert == null) return null; // one bad entry and the whole answer is not trusted
                alerts.add(alert);
            }
            return new Poll(alerts, rev);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static SosAlert one(Object item) {
        if (!(item instanceof Map)) return null;
        Map<?, ?> m = (Map<?, ?>) item;
        Object id = m.get("id");
        Object uid = m.get("senderUid");
        if (!(id instanceof String) || ((String) id).isEmpty() || ((String) id).length() > 64) return null;
        if (!(uid instanceof String) || ((String) uid).isEmpty() || ((String) uid).length() > 128) return null;
        long rev = whole(m.get("rev"), -1);
        if (rev < 0) return null;
        double lat = number(m.get("lat"));
        double lng = number(m.get("lng"));
        boolean located = !Double.isNaN(lat) && !Double.isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
        return new SosAlert(
            (String) id, (String) uid, cleanName(m.get("senderName")),
            located ? lat : Double.NaN, located ? lng : Double.NaN,
            rev, Math.max(0, whole(m.get("ageMs"), 0)), Math.max(0, whole(m.get("timestamp"), 0)));
    }

    private static long whole(Object v, long fallback) {
        if (!(v instanceof Double)) return fallback;
        double d = (Double) v;
        return d >= 0 && d < 9.0e15 ? (long) d : fallback;
    }

    private static double number(Object v) {
        return v instanceof Double ? (Double) v : Double.NaN;
    }

    /** A name to show: no control characters, at most {@link #MAX_NAME} long, null if nothing is left. */
    static String cleanName(Object raw) {
        if (!(raw instanceof String)) return null;
        StringBuilder b = new StringBuilder();
        for (char c : ((String) raw).toCharArray()) {
            if (c >= 0x20 && c != 0x7f) b.append(c);
            if (b.length() >= MAX_NAME) break;
        }
        String name = b.toString().trim();
        return name.isEmpty() ? null : name;
    }
}
