package com.locus.app.sharing;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Sends a report or a stop with plain HttpURLConnection (no dependency). One request, short
 * timeouts, no redirects followed (a redirect is an answer, not somewhere to send a token),
 * the answer read up to a few KB. Never logs: not the token, not the body, not the address.
 */
public final class UrlConnectionPoster {
    static final int TIMEOUT_MS = 10_000;
    static final int MAX_BODY_BYTES = 4096;
    /** A list of SOS is bigger than a report's answer; cut off here, and a cut-off list is simply not understood (SosPoll). */
    static final int SOS_MAX_BODY_BYTES = 32 * 1024;

    private final int timeoutMs;

    public UrlConnectionPoster() {
        this(TIMEOUT_MS);
    }

    UrlConnectionPoster(int timeoutMs) {
        this.timeoutMs = timeoutMs;
    }

    /** POST the report. */
    public HttpResult postLocation(String baseUrl, String deviceToken, String jsonBody) {
        return send("POST", baseUrl, Endpoint.LOCATION_PATH, deviceToken, jsonBody);
    }

    /** DELETE the session: the person has stopped sharing. */
    public HttpResult deleteSession(String baseUrl, String deviceToken) {
        return send("DELETE", baseUrl, Endpoint.SESSION_PATH, deviceToken, null);
    }

    /**
     * Asks whether the Group has raised an SOS since {@code afterRev}. The server holds the question
     * open for up to {@code waitSec} seconds when there is none (a long poll), so the read timeout
     * is longer than that wait, and the answer may be larger than a report's.
     */
    public HttpResult getSos(String baseUrl, String deviceToken, long afterRev, int waitSec) {
        return getSos(baseUrl, deviceToken, afterRev, waitSec, -1);
    }

    /** The same question, also asking how many wait to join (from joinAfterRev; -1 does not ask). */
    public HttpResult getSos(String baseUrl, String deviceToken, long afterRev, int waitSec, long joinAfterRev) {
        String path = Endpoint.SOS_PATH + "?after=" + Math.max(0, afterRev) + "&wait=" + Math.max(0, waitSec)
            + (joinAfterRev >= 0 ? "&joinAfter=" + joinAfterRev : "");
        return send("GET", baseUrl, path, deviceToken, null, (waitSec + 10) * 1000, SOS_MAX_BODY_BYTES);
    }

    /** This person has dealt with that SOS: the server stops offering it to them. */
    public HttpResult acknowledgeSos(String baseUrl, String deviceToken, String sosId) {
        if (sosId == null || sosId.isEmpty() || sosId.length() > 64 || sosId.indexOf('"') >= 0 || sosId.indexOf('\\') >= 0) return HttpResult.noAnswer();
        return send("POST", baseUrl, Endpoint.SOS_ACK_PATH, deviceToken, "{\"id\":\"" + sosId + "\"}");
    }

    /** Cuts off a question being held open, from another thread (the listener is stopping). */
    public void abort() {
        HttpURLConnection connection = current;
        if (connection != null) connection.disconnect();
    }

    private volatile HttpURLConnection current;

    private HttpResult send(String method, String baseUrl, String path, String deviceToken, String body) {
        return send(method, baseUrl, path, deviceToken, body, timeoutMs, MAX_BODY_BYTES);
    }

    private HttpResult send(String method, String baseUrl, String path, String deviceToken, String body, int readTimeoutMs, int maxBodyBytes) {
        String base = Endpoint.validate(baseUrl);
        if (base == null || deviceToken == null || deviceToken.isEmpty()) return HttpResult.noAnswer();
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + path).openConnection();
            current = connection;
            connection.setRequestMethod(method);
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(readTimeoutMs);
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setRequestProperty("Authorization", "Bearer " + deviceToken);
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            return new HttpResult(status, readSome(stream, maxBodyBytes), retryAfter(connection.getHeaderField("Retry-After")), false);
        } catch (Exception e) {
            return HttpResult.noAnswer();
        } finally {
            if (connection != null) connection.disconnect();
            if (current == connection) current = null;
        }
    }

    private static String readSome(InputStream stream, int maxBytes) {
        if (stream == null) return "";
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[512];
            int n;
            while (out.size() < maxBytes && (n = in.read(chunk)) > 0) out.write(chunk, 0, Math.min(n, maxBytes - out.size()));
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private static long retryAfter(String header) {
        if (header == null) return 0;
        try {
            return Math.max(0, Long.parseLong(header.trim()));
        } catch (NumberFormatException e) {
            return 0; // an HTTP date, or junk: ignore
        }
    }
}
