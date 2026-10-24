package com.locus.app.alerts;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Who is holding the alarm volume up, and what it was before. Pure bookkeeping, no Android: the
 * rules of {@link AlertVolume} in one place that a plain JUnit test can check.
 *
 * Each sound that needs the alarm stream loud is a holder ("app-sos", "app-ping", "svc-3" for the
 * service's alert in slot 3). The first holder saves the volume as it was and raises it; the last
 * one to let go puts the saved volume back. A holder named twice is still one holder. Holders
 * whose process has gone (the app killed while ringing, the service restarted) are let go of by
 * prefix when that process starts again, so a kill never leaves the phone's alarm turned up.
 */
public final class AlertVolumeLedger {
    /** Prefix of the holders that belong to the app's own process (MainActivity, the plugin). */
    public static final String APP = "app-";
    /** Prefix of the holders that belong to the background service. */
    public static final String SERVICE = "svc-";

    private final Set<String> holders = new LinkedHashSet<>();
    private int savedVolume = -1; // -1: nothing saved, the volume is the user's own

    public AlertVolumeLedger() {}

    /** Restores a ledger read back from storage. */
    public AlertVolumeLedger(Set<String> holders, int savedVolume) {
        if (holders != null) this.holders.addAll(holders);
        this.savedVolume = this.holders.isEmpty() ? -1 : savedVolume;
    }

    /**
     * {@code holder} wants the alarm loud. @return the volume to save (the current one) when this
     * is the first holder, or -1 when the volume is already raised and saved.
     */
    public int hold(String holder, int currentVolume) {
        boolean first = holders.isEmpty();
        holders.add(holder);
        if (!first) return -1;
        savedVolume = currentVolume;
        return savedVolume;
    }

    /** @return the volume to put back when that was the last holder, else -1 */
    public int release(String holder) {
        if (!holders.remove(holder)) return -1;
        return holders.isEmpty() ? takeSaved() : -1;
    }

    /** Lets go of every holder whose name starts with {@code prefix}. @return the volume to put back, or -1 */
    public int releaseAll(String prefix) {
        boolean any = holders.removeIf((h) -> h.startsWith(prefix));
        return any && holders.isEmpty() ? takeSaved() : -1;
    }

    private int takeSaved() {
        int saved = savedVolume;
        savedVolume = -1;
        return saved;
    }

    public boolean isRaised() {
        return !holders.isEmpty();
    }

    public Set<String> holders() {
        return Collections.unmodifiableSet(holders);
    }

    public int savedVolume() {
        return savedVolume;
    }

    /** The alarm volume an alert plays at: {@code fraction} of the maximum, at least 1, at most max. */
    public static int targetVolume(int max, double fraction) {
        if (max <= 0) return 0;
        double f = Double.isNaN(fraction) ? 1.0 : Math.max(0.0, Math.min(1.0, fraction));
        return Math.max(1, Math.min(max, (int) Math.round(max * f)));
    }
}
