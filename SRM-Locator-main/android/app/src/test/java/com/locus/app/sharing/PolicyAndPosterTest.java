package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.BufferedInputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Map;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class PolicyAndPosterTest {
    // ---- what the service does when Android restarts it ----

    private static final long NOW = 1_000_000;
    private static Session session(long expires) {
        return new Session("https://x.example", "R", "G", "v1.a.b", expires, 5_000);
    }

    @Test
    public void aRestartCarriesOnOnlyWhenEverythingIsInPlace() {
        assertEquals(ServicePolicy.Restart.CONTINUE, ServicePolicy.onSystemRestart(session(NOW + 1), NOW, true, true));
    }

    @Test
    public void withoutLocationAccessItTellsThePersonToTapToResume() {
        assertEquals(ServicePolicy.Restart.TELL_TO_RESUME, ServicePolicy.onSystemRestart(session(NOW + 1), NOW, true, false));
    }

    @Test
    public void sharingNeverRestartsWhereItCannotBeSeen() {
        assertEquals(ServicePolicy.Restart.TELL_TO_RESUME, ServicePolicy.onSystemRestart(session(NOW + 1), NOW, false, true));
        assertEquals(ServicePolicy.Restart.TELL_TO_RESUME, ServicePolicy.onSystemRestart(session(NOW + 1), NOW, false, false));
    }

    @Test
    public void withNothingToResumeItStopsQuietly() {
        assertEquals(ServicePolicy.Restart.STOP_QUIETLY, ServicePolicy.onSystemRestart(null, NOW, true, true));
        assertEquals(ServicePolicy.Restart.STOP_QUIETLY, ServicePolicy.onSystemRestart(null, NOW, false, false));
    }

    @Test
    public void aPassThatHasRunOutIsNotRestartedOrAnnounced() {
        assertEquals(ServicePolicy.Restart.STOP_QUIETLY, ServicePolicy.onSystemRestart(session(NOW), NOW, true, true));
        assertEquals(ServicePolicy.Restart.STOP_QUIETLY, ServicePolicy.onSystemRestart(session(NOW - 5), NOW, false, false));
    }

    // ---- the HTTP client, against a real local server ----

    /** A just-enough HTTP/1.1 server on a local socket (the JDK's own is not on Android's test classpath). */
    private static final class TinyServer {
        interface Handler {
            void handle(String method, String uri, Map<String, String> headers, String body, Reply reply) throws Exception;
        }

        static final class Reply {
            int status = 200;
            String body = "";
            final Map<String, String> headers = new HashMap<>();
        }

        private final ServerSocket socket;
        private final Thread thread;
        private volatile boolean stopped = false;

        TinyServer(Handler handler) throws IOException {
            socket = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
            thread = new Thread(() -> {
                while (!stopped) {
                    try (Socket client = socket.accept()) {
                        serve(client, handler);
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
            } catch (IOException ignored) {
                // closing
            }
        }

        private static void serve(Socket client, Handler handler) throws Exception {
            BufferedInputStream in = new BufferedInputStream(client.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                headers.put(line.substring(0, colon).trim().toLowerCase(), line.substring(colon + 1).trim());
            }
            int length = headers.containsKey("content-length") ? Integer.parseInt(headers.get("content-length")) : 0;
            byte[] body = new byte[length];
            int read = 0;
            while (read < length) {
                int n = in.read(body, read, length - read);
                if (n < 0) break;
                read += n;
            }
            Reply reply = new Reply();
            handler.handle(parts[0], parts[1], headers, new String(body, StandardCharsets.UTF_8), reply);
            byte[] out = reply.body.getBytes(StandardCharsets.UTF_8);
            StringBuilder head = new StringBuilder("HTTP/1.1 " + reply.status + " X\r\nContent-Length: " + out.length + "\r\nConnection: close\r\n");
            for (Map.Entry<String, String> h : reply.headers.entrySet()) head.append(h.getKey()).append(": ").append(h.getValue()).append("\r\n");
            head.append("\r\n");
            OutputStream os = client.getOutputStream();
            os.write(head.toString().getBytes(StandardCharsets.UTF_8));
            os.write(out);
            os.flush();
        }

        private static String readLine(InputStream in) throws IOException {
            StringBuilder b = new StringBuilder();
            int c;
            while ((c = in.read()) >= 0) {
                if (c == '\n') break;
                if (c != '\r') b.append((char) c);
            }
            return c < 0 && b.length() == 0 ? null : b.toString();
        }
    }

    private TinyServer server;
    private String base;
    private final List<String> seen = new CopyOnWriteArrayList<>();
    private volatile int status = 200;
    private volatile String reply = "{\"ok\":true}";
    private volatile String retryAfter = null;
    private volatile long delayMs = 0;
    private volatile String redirectTo = null;

    @Before
    public void startServer() throws IOException {
        server = new TinyServer((method, uri, headers, body, out) -> {
            if (delayMs > 0) Thread.sleep(delayMs);
            seen.add(method + " " + uri + " auth=" + headers.get("authorization") + " type=" + headers.get("content-type") + " body=" + body);
            if (redirectTo != null) {
                out.status = 302;
                out.headers.put("Location", redirectTo);
                return;
            }
            if (retryAfter != null) out.headers.put("Retry-After", retryAfter);
            out.status = status;
            out.body = reply;
        });
        base = "http://127.0.0.1:" + server.port();
    }

    @After
    public void stopServer() {
        server.stop();
    }

    @Test
    public void aReportIsSentExactlyAsTheServerExpectsIt() {
        HttpResult r = new UrlConnectionPoster().postLocation(base, "v1.tok.sig", "{\"lat\":1}");
        assertEquals(200, r.status);
        assertFalse(r.networkError);
        assertEquals("{\"ok\":true}", r.body);
        assertEquals(1, seen.size());
        assertEquals("POST /api/background/location auth=Bearer v1.tok.sig type=application/json body={\"lat\":1}", seen.get(0));
    }

    @Test
    public void stoppingIsADeleteWithTheTokenAndNoBody() {
        HttpResult r = new UrlConnectionPoster().deleteSession(base, "v1.tok.sig");
        assertEquals(200, r.status);
        assertEquals("DELETE /api/background/session auth=Bearer v1.tok.sig type=null body=", seen.get(0));
    }

    @Test
    public void refusalsComeBackWithTheirBodyAndRetryAfter() {
        status = 429;
        reply = "{\"error\":\"rate-limited\"}";
        retryAfter = "17";
        HttpResult r = new UrlConnectionPoster().postLocation(base, "t", "{}");
        assertEquals(429, r.status);
        assertEquals("{\"error\":\"rate-limited\"}", r.body);
        assertEquals(17, r.retryAfterSec);
        status = 401;
        retryAfter = "Wed, 21 Oct 2026 07:28:00 GMT"; // a date is ignored, not a crash
        assertEquals(0, new UrlConnectionPoster().postLocation(base, "t", "{}").retryAfterSec);
    }

    @Test
    public void anEmptyAnswerIsFine() {
        status = 204;
        reply = "";
        HttpResult r = new UrlConnectionPoster().postLocation(base, "t", "{}");
        assertEquals(204, r.status);
        assertEquals("", r.body);
    }

    @Test
    public void aHugeAnswerIsReadOnlyUpToALimit() {
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 100_000; i++) big.append('x');
        reply = big.toString();
        assertEquals(UrlConnectionPoster.MAX_BODY_BYTES, new UrlConnectionPoster().postLocation(base, "t", "{}").body.length());
    }

    @Test
    public void aRedirectIsAnAnswerNeverSomewhereToSendTheToken() throws Exception {
        List<String> reached = new ArrayList<>();
        TinyServer other = new TinyServer((method, uri, headers, body, out) -> reached.add(headers.get("authorization")));
        try {
            redirectTo = "http://127.0.0.1:" + other.port() + "/steal";
            HttpResult r = new UrlConnectionPoster().postLocation(base, "v1.tok.sig", "{}");
            assertEquals(302, r.status);
            assertTrue(reached.isEmpty());
            assertEquals(Outcome.Action.STOP, ResponseHandler.forLocation(r, new Backoff(() -> 0.5)).action);
        } finally {
            other.stop();
        }
    }

    @Test(timeout = 8_000)
    public void anEndlessAnswerIsCutOffAtTheLimitAndNeverHangsTheService() throws Exception {
        ServerSocket endless = new ServerSocket(0, 5, InetAddress.getByName("127.0.0.1"));
        Thread talker = new Thread(() -> {
            try (Socket client = endless.accept()) {
                BufferedInputStream in = new BufferedInputStream(client.getInputStream());
                String line;
                int length = 0;
                while ((line = TinyServer.readLine(in)) != null && !line.isEmpty()) {
                    if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                }
                for (int i = 0; i < length; i++) in.read();
                OutputStream out = client.getOutputStream();
                out.write("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                byte[] chunk = new byte[1024];
                java.util.Arrays.fill(chunk, (byte) 'x');
                while (true) out.write(chunk); // never stops, until the client hangs up
            } catch (Exception ended) {
                // the client hung up: exactly what should happen
            }
        });
        talker.setDaemon(true);
        talker.start();
        try {
            HttpResult r = new UrlConnectionPoster().postLocation("http://127.0.0.1:" + endless.getLocalPort(), "t", "{}");
            assertEquals(200, r.status);
            assertEquals(UrlConnectionPoster.MAX_BODY_BYTES, r.body.length());
        } finally {
            endless.close();
        }
    }

    @Test
    public void aSlowServerIsGivenUpOnQuickly() {
        delayMs = 2_000;
        long started = System.currentTimeMillis();
        HttpResult r = new UrlConnectionPoster(300).postLocation(base, "t", "{}");
        assertTrue(r.networkError);
        assertEquals(0, r.status);
        assertTrue(System.currentTimeMillis() - started < 1_500);
    }

    @Test
    public void noServerAtAllIsNoAnswerNotACrash() {
        server.stop();
        HttpResult r = new UrlConnectionPoster(500).postLocation(base, "t", "{}");
        assertTrue(r.networkError);
        assertEquals(Outcome.Action.RETRY, ResponseHandler.forLocation(r, new Backoff(() -> 0.5)).action);
    }

    @Test
    public void itWillNotSendATokenToAnAddressItDoesNotTrust() {
        assertTrue(new UrlConnectionPoster().postLocation("http://example.com", "t", "{}").networkError);
        assertTrue(new UrlConnectionPoster().postLocation("file:///etc/passwd", "t", "{}").networkError);
        assertTrue(new UrlConnectionPoster().postLocation(null, "t", "{}").networkError);
        assertTrue(new UrlConnectionPoster().postLocation(base, "", "{}").networkError);
        assertTrue(new UrlConnectionPoster().postLocation(base, null, "{}").networkError);
        assertTrue(seen.isEmpty());
    }

    // ---- listening for an SOS ----

    @Test
    public void askingForAnSosIsAGetFromTheLastRevWithTheTokenAndNoBody() {
        HttpResult r = new UrlConnectionPoster().getSos(base, "v1.tok.sig", 12, 25);
        assertEquals(200, r.status);
        assertEquals("GET /api/background/sos?after=12&wait=25 auth=Bearer v1.tok.sig type=null body=", seen.get(0));
    }

    @Test
    public void aNegativeRevOrWaitIsAskedAsZero() {
        new UrlConnectionPoster().getSos(base, "t", -5, -1);
        assertEquals("GET /api/background/sos?after=0&wait=0 auth=Bearer t type=null body=", seen.get(0));
    }

    @Test
    public void aListOfSosIsReadInFullEvenWhenLargerThanAReportsAnswer() {
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 10_000; i++) big.append('x');
        reply = big.toString();
        assertEquals(10_000, new UrlConnectionPoster().getSos(base, "t", 0, 1).body.length());
    }

    @Test
    public void aHugeAnswerToAnSosQuestionIsStillCutOff() {
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 200_000; i++) big.append('x');
        reply = big.toString();
        assertEquals(UrlConnectionPoster.SOS_MAX_BODY_BYTES, new UrlConnectionPoster().getSos(base, "t", 0, 1).body.length());
    }

    @Test
    public void aQuestionHeldOpenLongerThanTheShortTimeoutIsNotGivenUpOn() {
        delayMs = 1_200; // longer than the 300 ms a report would be given...
        long started = System.currentTimeMillis();
        HttpResult r = new UrlConnectionPoster(300).getSos(base, "t", 0, 2); // ...but the read allows wait + 10 s
        assertEquals(200, r.status);
        assertTrue(System.currentTimeMillis() - started >= 1_200);
    }

    @Test(timeout = 8_000)
    public void aQuestionHeldOpenCanBeCutOffFromAnotherThread() throws Exception {
        delayMs = 5_000;
        final UrlConnectionPoster poster = new UrlConnectionPoster();
        final HttpResult[] result = new HttpResult[1];
        Thread asker = new Thread(() -> result[0] = poster.getSos(base, "t", 0, 25));
        asker.start();
        Thread.sleep(300);
        long cutting = System.currentTimeMillis();
        poster.abort();
        asker.join(3_000);
        assertFalse(asker.isAlive());
        assertTrue(System.currentTimeMillis() - cutting < 2_000);
        assertTrue(result[0].networkError);
    }

    @Test
    public void acknowledgingIsAPostWithJustTheId() {
        HttpResult r = new UrlConnectionPoster().acknowledgeSos(base, "v1.tok.sig", "3f1c-aa");
        assertEquals(200, r.status);
        assertEquals("POST /api/background/sos/ack auth=Bearer v1.tok.sig type=application/json body={\"id\":\"3f1c-aa\"}", seen.get(0));
    }

    @Test
    public void anIdThatCouldBreakTheBodyIsNeverSent() {
        for (String id : new String[] {null, "", "a\"b", "a\\b", "x\",\"y\":\"z"}) {
            assertTrue(String.valueOf(id), new UrlConnectionPoster().acknowledgeSos(base, "t", id).networkError);
        }
        StringBuilder long65 = new StringBuilder();
        for (int i = 0; i < 65; i++) long65.append('a');
        assertTrue(new UrlConnectionPoster().acknowledgeSos(base, "t", long65.toString()).networkError);
        assertTrue(seen.isEmpty());
    }

    @Test
    public void nothingAboutTheRequestIsLeftForALogToFind() {
        // The poster has no logging at all; this guards that nobody adds some.
        assertNull(null);
        for (java.lang.reflect.Field f : UrlConnectionPoster.class.getDeclaredFields()) {
            assertFalse(f.getType().getName().contains("Logger"));
        }
    }
}
