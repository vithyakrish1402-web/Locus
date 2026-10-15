package com.locus.app.sharing;

import java.nio.charset.StandardCharsets;

/**
 * Keeps the session across the service being killed and restarted, sealed by the device's
 * Keystore. The rule: the token is NEVER written without being sealed. If sealing fails (no
 * Keystore, or it errors), {@link #save} says false and writes nothing, and the caller holds the
 * session in memory only; sharing then ends when the service dies, which is the safe failure.
 *
 * A second, plain record keeps only when the pass runs out and the Group's name, for the "Tap to
 * resume sharing with ..." notice after a restart. It holds nothing secret, is removed with the
 * rest, and stops being offered once the pass has run out.
 */
public final class TokenStore {
    /** Seals and opens bytes (the Keystore, in the app; a fake in tests). */
    public interface SecretBox {
        byte[] seal(byte[] plain) throws Exception;

        byte[] open(byte[] sealed) throws Exception;
    }

    /** Somewhere to put bytes under a name (SharedPreferences, in the app). */
    public interface KeyValue {
        byte[] get(String key);

        void put(String key, byte[] value);

        void remove(String key);
    }

    static final String SESSION_KEY = "session.sealed";
    static final String HINT_KEY = "session.hint";

    private final SecretBox box;
    private final KeyValue store;

    public TokenStore(SecretBox box, KeyValue store) {
        this.box = box;
        this.store = store;
    }

    /** @return whether the session was stored (sealed). False means: keep it in memory only. */
    public boolean save(Session session) {
        try {
            byte[] sealed = box.seal(session.toBytes());
            if (sealed == null || sealed.length == 0) return false;
            store.put(SESSION_KEY, sealed);
            store.put(HINT_KEY, (session.expiresAtMs + "\n" + session.groupName).getBytes(StandardCharsets.UTF_8));
            return true;
        } catch (Exception e) {
            // Whatever failed, nothing has been written in the clear. Leave no half-saved copy either.
            store.remove(SESSION_KEY);
            return false;
        }
    }

    /** @return the stored session, or null if there is none or it cannot be read (then it is removed). */
    public Session load() {
        byte[] sealed = store.get(SESSION_KEY);
        if (sealed == null) return null;
        try {
            Session session = Session.fromBytes(box.open(sealed));
            if (session != null) return session;
        } catch (Exception e) {
            // fall through: unreadable
        }
        clear();
        return null;
    }

    /** The Group's name for the resume notice, or null if there is nothing (left) to resume. */
    public String resumeHint(long nowMs) {
        byte[] hint = store.get(HINT_KEY);
        if (hint == null) return null;
        String text = new String(hint, StandardCharsets.UTF_8);
        int newline = text.indexOf('\n');
        if (newline <= 0) return null;
        try {
            if (nowMs >= Long.parseLong(text.substring(0, newline))) return null; // the pass has run out
        } catch (NumberFormatException e) {
            return null;
        }
        return text.substring(newline + 1);
    }

    public void clear() {
        store.remove(SESSION_KEY);
        store.remove(HINT_KEY);
    }
}
