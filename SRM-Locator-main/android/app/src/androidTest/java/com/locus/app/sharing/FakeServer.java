package com.locus.app.sharing;

import java.io.BufferedInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/** A fake background-sharing server on the device that records exactly what it is sent, and when. */
final class FakeServer {
    /** One request received. */
    static final class Received {
        final long atMs;
        final String text;

        Received(long atMs, String text) {
            this.atMs = atMs;
            this.text = text;
        }
    }

    private final ServerSocket socket;
    private final List<Received> requests = Collections.synchronizedList(new ArrayList<>());
    private final List<Integer> answered = Collections.synchronizedList(new ArrayList<>());
    volatile int status = 200;
    volatile String body = "{\"ok\":true}";
    private volatile boolean stopped = false;

    FakeServer() throws Exception {
        socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
        Thread thread = new Thread(() -> {
            while (!stopped) {
                try (Socket client = socket.accept()) {
                    serve(client);
                } catch (Exception e) {
                    if (stopped) return;
                }
            }
        });
        thread.setDaemon(true);
        thread.start();
    }

    int port() {
        return socket.getLocalPort();
    }

    void stop() {
        stopped = true;
        try {
            socket.close();
        } catch (Exception ignored) {
            // closing
        }
    }

    void reset() {
        requests.clear();
        answered.clear();
    }

    List<Received> all() {
        synchronized (requests) {
            return new ArrayList<>(requests);
        }
    }

    int count(String method) {
        return (int) all().stream().filter(r -> r.text.startsWith(method + " ")).count();
    }

    int countContaining(String text) {
        return (int) all().stream().filter(r -> r.text.contains(text)).count();
    }

    int countWithStatus(int s) {
        return (int) new ArrayList<>(answered).stream().filter(a -> a == s).count();
    }

    String first(String method) {
        return all().stream().filter(r -> r.text.startsWith(method + " ")).map(r -> r.text).findFirst().orElse("");
    }

    String last(String method) {
        String found = "";
        for (Received r : all()) if (r.text.startsWith(method + " ")) found = r.text;
        return found;
    }

    /** The latitude in a report body, or NaN. */
    static double latOf(String request) {
        int i = request.indexOf("\"lat\":");
        if (i < 0) return Double.NaN;
        int j = i + 6;
        int k = j;
        while (k < request.length() && "-0123456789.".indexOf(request.charAt(k)) >= 0) k++;
        return Double.parseDouble(request.substring(j, k));
    }

    private void serve(Socket client) throws Exception {
        BufferedInputStream in = new BufferedInputStream(client.getInputStream());
        String requestLine = line(in);
        if (requestLine == null || requestLine.isEmpty()) return;
        String[] parts = requestLine.split(" ");
        AtomicReference<String> auth = new AtomicReference<>();
        int length = 0;
        String header;
        while ((header = line(in)) != null && !header.isEmpty()) {
            String lower = header.toLowerCase();
            if (lower.startsWith("authorization:")) auth.set(header.substring(14).trim());
            if (lower.startsWith("content-length:")) length = Integer.parseInt(header.substring(15).trim());
        }
        byte[] bodyBytes = new byte[length];
        int read = 0;
        while (read < length) {
            int n = in.read(bodyBytes, read, length - read);
            if (n < 0) break;
            read += n;
        }
        long at = System.currentTimeMillis();
        requests.add(new Received(at, parts[0] + " " + parts[1] + " auth=" + auth.get() + " body=" + new String(bodyBytes, StandardCharsets.UTF_8)));
        int replyStatus = status;
        byte[] out = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + replyStatus + " X\r\nContent-Length: " + out.length + "\r\nConnection: close\r\n\r\n";
        OutputStream os = client.getOutputStream();
        os.write(head.getBytes(StandardCharsets.UTF_8));
        os.write(out);
        os.flush();
        answered.add(replyStatus);
    }

    private static String line(InputStream in) throws Exception {
        StringBuilder b = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.append((char) c);
        }
        return c < 0 && b.length() == 0 ? null : b.toString();
    }
}
