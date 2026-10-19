package com.locus.app.sharing;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Decides what an SOS heard from the background becomes on this phone. Pure: the service gives it
 * the facts, it says what to do.
 *
 *  - ALERT   a new SOS, and the app is not on screen: ring, vibrate, wake the screen.
 *  - UPDATE  the same SOS again (pressed again: same id, newer rev; or the same person within
 *            {@link #SOS_DEDUPE_WINDOW_MS} of their last alert): the notification is replaced in
 *            its place, quietly. They never pile up, one slot per sender.
 *  - IGNORE  already seen at this rev; or the app is on screen (its own overlay handles it, so the
 *            person never gets both); or the person turned these alerts off.
 *
 * What was seen is remembered even when ignored, so an SOS the app showed does not ring later
 * because the app was then closed.
 */
public final class SosLedger {
    /** The same sender's SOS within this long of their last alert is one alert (a replacement, not a second ring). */
    public static final long SOS_DEDUPE_WINDOW_MS = 30_000;
    /** How many SOS ids are remembered; the oldest are forgotten first. (An SOS lives 30 minutes on the server.) */
    static final int REMEMBER = 64;
    /** Notification slots: one per sender, reused round and round. */
    public static final int SLOTS = 50;

    public enum Verdict { IGNORE, ALERT, UPDATE }

    public static final class Decision {
        public final Verdict verdict;
        /** Which notification slot this sender uses (0 to SLOTS-1), for ALERT and UPDATE. */
        public final int slot;

        Decision(Verdict verdict, int slot) {
            this.verdict = verdict;
            this.slot = slot;
        }
    }

    private static final class Seen {
        long rev;
        boolean alerted;
        String senderUid;
    }

    private static final class Sender {
        int slot;
        long lastAlertAtMs = -1;
    }

    private final Map<String, Seen> seen = new LinkedHashMap<String, Seen>(16, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Seen> eldest) {
            return size() > REMEMBER;
        }
    };
    private final Map<String, Sender> senders = new LinkedHashMap<String, Sender>(16, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Sender> eldest) {
            return size() > REMEMBER * 2;
        }
    };
    private int nextSlot = 0;

    public synchronized Decision decide(SosAlert alert, boolean appLive, boolean enabled, long nowMs) {
        Sender sender = senders.get(alert.senderUid);
        if (sender == null) {
            sender = new Sender();
            sender.slot = nextSlot;
            nextSlot = (nextSlot + 1) % SLOTS;
            senders.put(alert.senderUid, sender);
        }
        Seen before = seen.get(alert.id);
        if (before != null && alert.rev <= before.rev) return new Decision(Verdict.IGNORE, sender.slot);
        Seen now = before != null ? before : new Seen();
        now.rev = alert.rev;
        now.senderUid = alert.senderUid;
        seen.put(alert.id, now);

        if (appLive || !enabled) return new Decision(Verdict.IGNORE, sender.slot);

        boolean continuesAnAlert = (before != null && before.alerted)
            || (sender.lastAlertAtMs >= 0 && nowMs - sender.lastAlertAtMs < SOS_DEDUPE_WINDOW_MS);
        now.alerted = true;
        if (continuesAnAlert) return new Decision(Verdict.UPDATE, sender.slot);
        sender.lastAlertAtMs = nowMs;
        return new Decision(Verdict.ALERT, sender.slot);
    }

    /** The slot of the notification an SOS was shown in, or -1 if it never was. */
    public synchronized int slotOf(String sosId) {
        Seen s = seen.get(sosId);
        if (s == null || !s.alerted) return -1;
        Sender sender = senders.get(s.senderUid);
        return sender == null ? -1 : sender.slot;
    }
}
