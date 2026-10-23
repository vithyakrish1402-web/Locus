package com.locus.app.sharing;

import java.net.URI;
import java.util.Locale;

/**
 * Where the server is, and the addresses on it. The device token is a bearer secret, so it only
 * ever travels over https; plain http is allowed for the developer's own machine (localhost,
 * 127.0.0.1, the Android emulator's 10.0.2.2) and nothing else. (The app as a whole allows
 * cleartext traffic for development; this is stricter on purpose.)
 */
public final class Endpoint {
    public static final String LOCATION_PATH = "/api/background/location";
    public static final String SESSION_PATH = "/api/background/session";
    public static final String SOS_PATH = "/api/background/sos";
    public static final String SOS_ACK_PATH = "/api/background/sos/ack";

    private Endpoint() {}

    /** The base address without a trailing slash, or null if it is not one we will send a token to. */
    public static String validate(String baseUrl) {
        if (baseUrl == null) return null;
        String trimmed = baseUrl.trim();
        if (trimmed.length() == 0 || trimmed.length() > 300 || !trimmed.equals(baseUrl)) return null;
        URI uri;
        try {
            uri = new URI(trimmed);
        } catch (Exception e) {
            return null;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost();
        if (host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) return null;
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (!(path.isEmpty() || path.equals("/"))) return null;
        boolean local = host.equals("localhost") || host.equals("127.0.0.1") || host.equals("10.0.2.2");
        if (!(scheme.equals("https") || (scheme.equals("http") && local))) return null;
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }
}
