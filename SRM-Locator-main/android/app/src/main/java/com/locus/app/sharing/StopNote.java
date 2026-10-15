package com.locus.app.sharing;

import java.nio.charset.StandardCharsets;

/**
 * Why sharing last stopped by itself, kept on disk so the app can say so when it is next opened,
 * even if Android killed the process in between (the in-memory state is gone by then). Not a
 * secret: just a short reason word such as "group-gone". Pure over a KeyValue.
 *
 * Only endings the person did not ask for are kept: pressing Stop, logging out and leaving
 * (reason "user-stop") clear it instead. It is cleared again once the app has shown it
 * (acknowledge) and whenever sharing starts.
 */
public final class StopNote {
    static final String KEY = "last-stop";
    static final String USER_STOP = "user-stop";

    private final TokenStore.KeyValue store;

    public StopNote(TokenStore.KeyValue store) {
        this.store = store;
    }

    public void record(String reason) {
        if (reason == null || reason.isEmpty() || USER_STOP.equals(reason) || !reason.matches("[a-z-]{1,40}")) {
            clear();
            return;
        }
        try {
            store.put(KEY, reason.getBytes(StandardCharsets.UTF_8));
        } catch (RuntimeException e) {
            // Cannot keep it; the in-memory state still tells a live app.
        }
    }

    /** The reason, or null when there is none (or it is not one of ours). */
    public String read() {
        try {
            byte[] bytes = store.get(KEY);
            if (bytes == null || bytes.length == 0 || bytes.length > 400) return null;
            String reason = new String(bytes, StandardCharsets.UTF_8);
            return reason.matches("[a-z-]{1,40}") ? reason : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    public void clear() {
        try {
            store.remove(KEY);
        } catch (RuntimeException e) {
            // Nothing to clear.
        }
    }
}
