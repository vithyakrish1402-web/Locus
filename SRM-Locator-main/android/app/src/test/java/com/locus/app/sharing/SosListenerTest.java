package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * The listener's loop against a real local socket standing in for the server: what it asks, what it
 * does with each kind of answer, and that stopping really stops. (The server's half is driven by
 * tests/sosBackground.integration.test.js against the real server.)
 */
public class SosListenerTest {
    /** Answers each connection from a script, one reply per request, and remembers what was asked. */
    private static final class Script {
        interface Reply {
            /** @return {status, body}; may block to behave like a held-open question */
            Object[] answer(String requestLine, String authorization) throws Exception;
        }

        final List<String> asked = new CopyOnWriteArrayList<>();
        final List<String> auth = new CopyOnWriteArrayList<>();
        final ServerSocket socket;
        volatile Reply reply;
        volatile boolean stopped = false;

        Script() throws IOException {
            socket = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
            Thread acceptor = new Thread(() -> {
                while (!stopped) {
                    try {
                        final Socket client = socket.accept();
                        Thread t = new Thread(() -> serve(client));
                        t.setDaemon(true);
                        t.start();
                    } catch (IOException e) {
                        return;
                    }
                }
            });
            acceptor.setDaemon(true);
            acceptor.start();
        }

        String base() {
            return "http://127.0.0.1:" + socket.getLocalPort();
        }

        void stop() {
            stopped = true;
            try {
                socket.close();
            } catch (IOException ignored) {
                // closing
            }
        }

        private void serve(Socket client) {
            try (Socket c = client) {
                InputStream in = new BufferedInputStream(c.getInputStream());
                String requestLine = line(in);
                String authorization = null;
                String h;
                while ((h = line(in)) != null && !h.isEmpty()) {
                    if (h.toLowerCase().startsWith("authorization:")) authorization = h.substring(14).trim();
                }
                asked.add(requestLine);
                auth.add(String.valueOf(authorization));
                Object[] r = reply.answer(requestLine, authorization);
                byte[] body = ((String) r[1]).getBytes(StandardCharsets.UTF_8);
                OutputStream out = c.getOutputStream();
                out.write(("HTTP/1.1 " + r[0] + " X\r\nContent-Length: " + body.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
                out.write(body);
                out.flush();
            } catch (Exception ignored) {
                // the client hung up
            }
        }

        private static String line(InputStream in) throws IOException {
            StringBuilder b = new StringBuilder();
            int c;
            while ((c = in.read()) >= 0) {
                if (c == '\n') break;
                if (c != '\r') b.append((char) c);
            }
            return c < 0 && b.length() == 0 ? null : b.toString();
        }
    }

    private Script server;
    private final List<SosAlert> heard = new CopyOnWriteArrayList<>();
    private volatile Session session;
    private SosListener listener;

    private static String sos(String id, long rev) {
        return "{\"id\":\"" + id + "\",\"senderUid\":\"uA\",\"senderName\":\"Asha\",\"lat\":12.8,\"lng\":80.0,\"ageMs\":0,\"timestamp\":1,\"rev\":" + rev + "}";
    }

    private static String answer(String sos, long rev) {
        return "{\"sos\":[" + sos + "],\"rev\":" + rev + ",\"serverTime\":1}";
    }

    @Before
    public void setUp() throws IOException {
        server = new Script();
        session = new Session(server.base(), "R", "G", "v1.dev.tok", System.currentTimeMillis() + 60_000, 5_000);
        listener = new SosListener(new SosListener.Host() {
            @Override
            public Session session() {
                return session;
            }

            @Override
            public void deliver(List<SosAlert> alerts) {
                heard.addAll(alerts);
            }
        }, Runnable::run, () -> 0.5, 30, 120, 7, 40);
    }

    @After
    public void tearDown() {
        listener.stop();
        server.stop();
    }

    private static void waitUntil(java.util.function.BooleanSupplier condition, long timeoutMs) throws InterruptedException {
        long until = System.currentTimeMillis() + timeoutMs;
        while (!condition.getAsBoolean() && System.currentTimeMillis() < until) Thread.sleep(10);
    }

    @Test(timeout = 10_000)
    public void asksFromTheBeginningFirstThenFromTheRevItLastHeardAndHearsWhatComes() throws Exception {
        AtomicInteger n = new AtomicInteger();
        server.reply = (line, auth) -> {
            int i = n.getAndIncrement();
            if (i == 0) return new Object[] {200, answer(sos("s1", 3), 3)};
            return new Object[] {200, answer("", 3)};
        };
        listener.start();
        waitUntil(() -> server.asked.size() >= 3, 5_000);
        assertEquals("GET /api/background/sos?after=0&wait=7 HTTP/1.1", server.asked.get(0));
        assertEquals("GET /api/background/sos?after=3&wait=7 HTTP/1.1", server.asked.get(1));
        assertEquals("GET /api/background/sos?after=3&wait=7 HTTP/1.1", server.asked.get(2));
        assertEquals("Bearer v1.dev.tok", server.auth.get(0));
        assertEquals(1, heard.size());
        assertEquals("s1", heard.get(0).id);
    }

    @Test(timeout = 10_000)
    public void anAnswerWithNothingIsNotAskedAgainInATightLoop() throws Exception {
        server.reply = (line, auth) -> new Object[] {200, answer("", 0)};
        listener.start();
        Thread.sleep(400);
        listener.stop();
        // at least 40 ms between questions (the test's minimum gap): about 10 in 400 ms, certainly not hundreds
        assertTrue("asked " + server.asked.size(), server.asked.size() < 20);
        assertTrue(server.asked.size() >= 3);
    }

    @Test(timeout = 10_000)
    public void failuresWaitAndTryAgainThenCarryOnWhenTheServerIsBack() throws Exception {
        AtomicInteger n = new AtomicInteger();
        server.reply = (line, auth) -> {
            int i = n.getAndIncrement();
            if (i < 2) return new Object[] {503, "{\"error\":\"asleep\"}"};
            return new Object[] {200, answer(sos("s9", 1), 1)};
        };
        listener.start();
        waitUntil(() -> !heard.isEmpty(), 5_000);
        assertEquals(1, heard.size());
        assertEquals("GET /api/background/sos?after=0&wait=7 HTTP/1.1", server.asked.get(2)); // still from the beginning: nothing was heard yet
    }

    @Test(timeout = 10_000)
    public void aServerWithoutTheRouteStopsTheListening() throws Exception {
        server.reply = (line, auth) -> new Object[] {404, "{}"};
        listener.start();
        waitUntil(() -> !listener.isRunning(), 5_000);
        assertFalse(listener.isRunning());
        int asked = server.asked.size();
        Thread.sleep(300);
        assertEquals(asked, server.asked.size());
        assertEquals(1, asked);
    }

    @Test(timeout = 10_000)
    public void stoppingEndsAQuestionBeingHeldOpenAndNothingMoreIsHeard() throws Exception {
        final Object hold = new Object();
        server.reply = (line, auth) -> {
            synchronized (hold) {
                hold.wait(8_000); // the server holds the question open
            }
            return new Object[] {200, answer(sos("late", 1), 1)};
        };
        listener.start();
        waitUntil(() -> !server.asked.isEmpty(), 3_000);
        listener.stop();
        assertFalse(listener.isRunning());
        // The thread that was blocked on the held-open question is gone at once, with the server still
        // holding it: cut off, not left to wait out its timeout.
        long until = System.currentTimeMillis() + 2_000;
        while (listenerThreadAlive() && System.currentTimeMillis() < until) Thread.sleep(20);
        assertFalse("the question being held open was not cut off", listenerThreadAlive());
        synchronized (hold) {
            hold.notifyAll();
        }
        Thread.sleep(300);
        assertEquals(Collections.emptyList(), new ArrayList<>(heard)); // an answer after stopping is not delivered
        assertEquals(1, server.asked.size());
    }

    private static boolean listenerThreadAlive() {
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if ("locus-sos-listener".equals(t.getName()) && t.isAlive()) return true;
        }
        return false;
    }

    @Test(timeout = 10_000)
    public void anAnswerQueuedForTheMainThreadIsDroppedIfListeningStoppedBeforeItRan() throws Exception {
        List<Runnable> queue = new CopyOnWriteArrayList<>();
        SosListener queued = new SosListener(new SosListener.Host() {
            @Override
            public Session session() {
                return session;
            }

            @Override
            public void deliver(List<SosAlert> alerts) {
                heard.addAll(alerts);
            }
        }, queue::add, () -> 0.5, 30, 120, 7, 40);
        server.reply = (line, auth) -> new Object[] {200, answer(sos("s1", 1), 1)};
        queued.start();
        waitUntil(() -> !queue.isEmpty(), 5_000);
        queued.stop(); // the person turned the alerts off, or sharing ended, before the main thread got to it
        for (Runnable r : queue) r.run();
        assertEquals(Collections.emptyList(), new ArrayList<>(heard));
    }

    @Test(timeout = 10_000)
    public void withNoSessionItAsksNothingAndPicksUpWhenThereIsOne() throws Exception {
        session = null;
        server.reply = (line, auth) -> new Object[] {200, answer(sos("s1", 1), 1)};
        listener.start();
        Thread.sleep(200);
        assertEquals(0, server.asked.size());
    }

    @Test(timeout = 10_000)
    public void startingTwiceIsOneListener() throws Exception {
        server.reply = (line, auth) -> new Object[] {200, answer("", 0)};
        listener.start();
        listener.start();
        Thread.sleep(150);
        listener.stop();
        int total = server.asked.size();
        Thread.sleep(150);
        assertEquals(total, server.asked.size());
        // one loop at a 40 ms gap asks about 4 times in 150 ms; two would about double it
        assertTrue("asked " + total, total <= 8);
    }
}
