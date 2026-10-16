package com.locus.app.sharing;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * What the service needs to report for one person to one Group: where, which Group, and the
 * device token that lets it. Immutable. toString() deliberately says nothing, so a stray log
 * line cannot leak the token.
 */
public final class Session {
    public final String baseUrl; // already validated by Endpoint
    public final String roomCode;
    public final String groupName;
    public final String deviceToken;
    public final long expiresAtMs;
    public final long pollingMs;

    public Session(String baseUrl, String roomCode, String groupName, String deviceToken, long expiresAtMs, long pollingMs) {
        this.baseUrl = baseUrl;
        this.roomCode = roomCode;
        this.groupName = groupName;
        this.deviceToken = deviceToken;
        this.expiresAtMs = expiresAtMs;
        this.pollingMs = pollingMs;
    }

    public Session withToken(String token, long newExpiresAtMs) {
        return new Session(baseUrl, roomCode, groupName, token, newExpiresAtMs, pollingMs);
    }

    public Session withPolling(long newPollingMs) {
        return new Session(baseUrl, roomCode, groupName, deviceToken, expiresAtMs, newPollingMs);
    }

    byte[] toBytes() {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            DataOutputStream data = new DataOutputStream(out);
            data.writeInt(1); // format version
            for (String s : new String[] {baseUrl, roomCode, groupName, deviceToken}) {
                byte[] raw = s.getBytes(StandardCharsets.UTF_8);
                data.writeInt(raw.length);
                data.write(raw);
            }
            data.writeLong(expiresAtMs);
            data.writeLong(pollingMs);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** @return the session, or null if the bytes are not one */
    static Session fromBytes(byte[] bytes) {
        try {
            DataInputStream data = new DataInputStream(new ByteArrayInputStream(bytes));
            if (data.readInt() != 1) return null;
            String[] parts = new String[4];
            for (int i = 0; i < parts.length; i++) {
                int length = data.readInt();
                if (length < 0 || length > 8192) return null;
                byte[] raw = new byte[length];
                data.readFully(raw);
                parts[i] = new String(raw, StandardCharsets.UTF_8);
            }
            long expires = data.readLong();
            long polling = data.readLong();
            if (data.available() != 0) return null;
            return new Session(parts[0], parts[1], parts[2], parts[3], expires, polling);
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    @Override
    public String toString() {
        return "Session[redacted]";
    }
}
