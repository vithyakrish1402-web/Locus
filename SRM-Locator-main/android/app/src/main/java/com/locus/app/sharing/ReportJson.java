package com.locus.app.sharing;

import java.math.BigDecimal;

/**
 * The body of a location report, written by hand so it is the same everywhere (no Android JSON
 * classes, no locale surprises) and so a value the server would refuse is never sent: out of
 * range numbers are clamped, and ones that are not numbers are left out. Only a fix with a
 * usable position produces a body at all.
 */
public final class ReportJson {
    private ReportJson() {}

    /**
     * @param status "ACTIVE" or "FROZEN"
     * @param batteryPct 0-100, or negative when unknown
     * @return the JSON body, or null when the fix has no usable position
     */
    public static String build(Fix fix, String status, int nextPostWithinSec, int batteryPct) {
        if (fix == null || !finite(fix.lat) || !finite(fix.lng) || fix.lat < -90 || fix.lat > 90 || fix.lng < -180 || fix.lng > 180) return null;
        StringBuilder b = new StringBuilder(160);
        b.append("{\"lat\":").append(num(fix.lat));
        b.append(",\"lng\":").append(num(fix.lng));
        b.append(",\"nextPostWithinSec\":").append(Math.max(1, Math.min(300, nextPostWithinSec)));
        if (finite(fix.accuracyM) && fix.accuracyM >= 0) b.append(",\"accuracy\":").append(num(Math.min(fix.accuracyM, 100000)));
        // km/h, as the app sends it
        if (finite(fix.speedMps) && fix.speedMps >= 0) b.append(",\"speed\":").append(Math.min(Math.round(fix.speedMps * 3.6), 400));
        if (finite(fix.headingDeg)) b.append(",\"heading\":").append(num(((fix.headingDeg % 360) + 360) % 360));
        if (batteryPct >= 0) b.append(",\"battery\":").append(Math.min(batteryPct, 100));
        b.append(",\"status\":\"").append("FROZEN".equals(status) ? "FROZEN" : "ACTIVE").append('"');
        return b.append('}').toString();
    }

    private static boolean finite(double d) {
        return !Double.isNaN(d) && !Double.isInfinite(d);
    }

    // Plain decimal, never scientific notation, always a dot, at most 7 decimal places.
    private static String num(double d) {
        return new BigDecimal(d).setScale(7, java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }
}
