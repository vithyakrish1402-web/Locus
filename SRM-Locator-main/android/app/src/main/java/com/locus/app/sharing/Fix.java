package com.locus.app.sharing;

/** One position fix, as the service holds it. Plain data: no Android types, so it is testable. */
public final class Fix {
    public final double lat;
    public final double lng;
    /** Metres; NaN when the phone did not say. */
    public final double accuracyM;
    /** Metres per second; NaN when the phone did not say. */
    public final double speedMps;
    /** Degrees; NaN when the phone did not say. */
    public final double headingDeg;
    /** SystemClock-independent wall time the fix was taken (epoch ms). */
    public final long takenAtMs;

    public Fix(double lat, double lng, double accuracyM, double speedMps, double headingDeg, long takenAtMs) {
        this.lat = lat;
        this.lng = lng;
        this.accuracyM = accuracyM;
        this.speedMps = speedMps;
        this.headingDeg = headingDeg;
        this.takenAtMs = takenAtMs;
    }
}
