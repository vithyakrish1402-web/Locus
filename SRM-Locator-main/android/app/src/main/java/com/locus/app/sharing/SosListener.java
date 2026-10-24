package com.locus.app.sharing;

import java.util.concurrent.Executor;

import java.util.List;

/**
 * Listens for an SOS from the person's Group while LOCUS is closed. It lives inside the sharing
 * service (a foreground service, so the phone keeps it and its network going) and asks the server
 * the same question over and over: "anything new since rev N?". The server holds each question open
 * for up to {@link #WAIT_SEC} seconds, so an SOS arrives the moment it is raised, and an answer
 * with nothing in it is just the question asked again. No socket and no library: plain HTTPS with
 * the device token the service already holds, which is for one person and one Group, so nobody
 * outside the Group can hear or raise anything this way (backend/backgroundSharing.js).
 *
 * Reconnecting: a failed question waits 2 s, then 4, 8, 16, up to 30 s (with jitter), and the first
 * answer starts it over. The next question always asks from the last rev heard, and a phone that
 * has just started asks from the beginning, so an SOS raised while the phone was out of reach is
 * heard as soon as it is back.
 *
 * The same question also asks how many people wait to join the Group (JoinNotice): the server
 * answers that only to the Group's main admin and moderators, and the listener hands each change
 * to {@link Host#deliverJoin}.
 */
final class SosListener {
    /** Reconnect timing in the background: 2 s doubling up to a 30 s ceiling. */
    static final long SOS_LISTENER_RECONNECT_BACKOFF_BASE_MS = 2_000;
    static final long SOS_LISTENER_RECONNECT_BACKOFF_CAP_MS = 30_000;
    /** How long the server may hold one question open. It caps this at 25 s itself. */
    static final int WAIT_SEC = 25;
    /** An answer that comes back sooner than this with nothing in it is not asked again at once. */
    static final long MIN_GAP_MS = 1_000;
    private static final long NO_SESSION_WAIT_MS = 5_000;

    interface Host {
        /** The session to listen with right now, or null. Any thread. */
        Session session();

        /** What was heard. Always called on the main thread. */
        void deliver(List<SosAlert> alerts);

        /** A new number of people waiting to join. Always called on the main thread. */
        default void deliverJoin(JoinNotice notice) {}
        default void deliverPing(PingNotice notice) {}
    }

    private final Host host;
    private final Executor main; // runs what it is given on the main thread (the tests run it where they stand)
    private final java.util.function.DoubleSupplier random;
    private final long backoffBaseMs;
    private final long backoffCapMs;
    private final int waitSec;
    private final long minGapMs;
    private final Object lock = new Object();
    private Object current; // identifies the run in progress; a stopped run sees it change
    private UrlConnectionPoster currentPoster;

    SosListener(Host host, Executor main, java.util.function.DoubleSupplier random) {
        this(host, main, random, SOS_LISTENER_RECONNECT_BACKOFF_BASE_MS, SOS_LISTENER_RECONNECT_BACKOFF_CAP_MS, WAIT_SEC, MIN_GAP_MS);
    }

    /** The timings are the tests' to shorten; the service uses the constants above. */
    SosListener(Host host, Executor main, java.util.function.DoubleSupplier random, long backoffBaseMs, long backoffCapMs, int waitSec, long minGapMs) {
        this.host = host;
        this.main = main;
        this.random = random;
        this.backoffBaseMs = backoffBaseMs;
        this.backoffCapMs = backoffCapMs;
        this.waitSec = waitSec;
        this.minGapMs = minGapMs;
    }

    void start() {
        final Object run = new Object();
        final UrlConnectionPoster poster = new UrlConnectionPoster();
        synchronized (lock) {
            if (current != null) return;
            current = run;
            currentPoster = poster;
        }
        Thread thread = new Thread(() -> loop(run, poster), "locus-sos-listener");
        thread.setDaemon(true);
        thread.start();
    }

    void stop() {
        UrlConnectionPoster poster;
        synchronized (lock) {
            current = null;
            poster = currentPoster;
            currentPoster = null;
            lock.notifyAll();
        }
        if (poster != null) poster.abort(); // a question being held open ends now
    }

    boolean isRunning() {
        synchronized (lock) {
            return current != null;
        }
    }

    private boolean alive(Object run) {
        synchronized (lock) {
            return current == run;
        }
    }

    private void pause(Object run, long ms) {
        long until = System.currentTimeMillis() + ms;
        synchronized (lock) {
            while (current == run) {
                long left = until - System.currentTimeMillis();
                if (left <= 0) return;
                try {
                    lock.wait(left);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    private void loop(Object run, UrlConnectionPoster poster) {
        Backoff backoff = new Backoff(random, backoffBaseMs, backoffCapMs);
        long after = 0;
        long pingAfter = 0;
        String sessionToken = null;
        long joinAfter = 0; // the last join rev heard; a phone that has just started hears the current one
        while (alive(run)) {
            Session session = host.session();
            if (session == null) {
                pause(run, NO_SESSION_WAIT_MS);
                continue;
            }
            if (!session.deviceToken.equals(sessionToken)) {
                sessionToken = session.deviceToken;
                after = 0; joinAfter = 0; pingAfter = 0;
            }
            long asked = System.currentTimeMillis();
            HttpResult result = poster.getSos(session.baseUrl, session.deviceToken, after, waitSec, joinAfter, pingAfter);
            if (!alive(run)) return;
            SosPollHandler.Next next = SosPollHandler.forPoll(result, backoff);
            switch (next.action) {
                case DELIVER:
                    after = next.rev;
                    for (PingNotice ping : PingNotice.parse(result.body)) {
                        if (ping.rev <= pingAfter) continue;
                        pingAfter = ping.rev;
                        final String token = session.deviceToken;
                        main.execute(() -> {
                            Session latest = host.session();
                            if (alive(run) && latest != null && token.equals(latest.deviceToken)) host.deliverPing(ping);
                        });
                    }
                    JoinNotice join = JoinNotice.parse(result.body);
                    if (join != null && join.rev != joinAfter) {
                        joinAfter = join.rev;
                        main.execute(() -> {
                            if (alive(run)) host.deliverJoin(join);
                        });
                    }
                    if (!next.alerts.isEmpty()) {
                        final List<SosAlert> heard = next.alerts;
                        main.execute(() -> {
                            if (alive(run)) host.deliver(heard);
                        });
                    }
                    long took = System.currentTimeMillis() - asked;
                    if (took < minGapMs) pause(run, minGapMs - took);
                    break;
                case WAIT:
                    pause(run, next.delayMs);
                    break;
                default:
                    synchronized (lock) {
                        if (current == run) {
                            current = null;
                            currentPoster = null;
                        }
                    }
                    return;
            }
        }
    }
}
