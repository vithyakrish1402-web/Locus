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

    private HttpResult send(String method, String baseUrl, String path, String deviceToken, String body) {
        String base = Endpoint.validate(baseUrl);
        if (base == null || deviceToken == null || deviceToken.isEmpty()) return HttpResult.noAnswer();
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + path).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
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
            return new HttpResult(status, readSome(stream), retryAfter(connection.getHeaderField("Retry-After")), false);
        } catch (Exception e) {
            return HttpResult.noAnswer();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readSome(InputStream stream) {
        if (stream == null) return "";
        try (InputStream in = stream) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[512];
            int n;
            while (out.size() < MAX_BODY_BYTES && (n = in.read(chunk)) > 0) out.write(chunk, 0, Math.min(n, MAX_BODY_BYTES - out.size()));
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
