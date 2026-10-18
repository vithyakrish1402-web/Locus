package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The retry window across a server restart, and which endings get a notice. */
public class OutageAndNoticeTest {
    private static Outcome answer(int status, String body, Backoff b) {
        return ResponseHandler.forLocation(new HttpResult(status, body, 0, false), b);
    }

    // ---- what counts as the server being unreachable ----

    @Test
    public void noAnswer502503and504AreOutages() {
        Backoff b = new Backoff(() -> 0.5);
        assertTrue(ResponseHandler.forLocation(HttpResult.noAnswer(), b).serverUnreachable);
        for (int s : new int[] {502, 503, 504}) {
            Outcome o = answer(s, "", b);
            assertEquals(Outcome.Action.RETRY, o.action);
            assertTrue("status " + s, o.serverUnreachable);
        }
    }

    @Test
    public void aServerThatAnswersIsNotAnOutage() {
        Backoff b = new Backoff(() -> 0.5);
        assertFalse(ResponseHandler.forLocation(new HttpResult(429, "", 30, false), b).serverUnreachable);
        assertFalse(answer(500, "", b).serverUnreachable);
        assertFalse(answer(200, "{}", b).serverUnreachable);
        assertFalse(answer(410, "", b).serverUnreachable);
    }

    @Test
    public void disabled503StillStopsRatherThanRetrying() {
        Outcome o = answer(503, "{\"error\":\"disabled\"}", new Backoff(() -> 0.5));
        assertEquals(Outcome.Action.STOP, o.action);
        assertFalse(o.serverUnreachable);
    }

    // ---- the retries cover a free instance's cold start ----

    @Test
    public void theFirstSevenRetriesCoverThreeMinutesEvenWithTheLowestJitter() {
        Backoff b = new Backoff(() -> 0.0); // -20% every time
        long total = 0;
        for (int i = 0; i < 7; i++) total += b.next();
        assertTrue("waited " + total, total >= 180_000);
    }

    @Test
    public void givesUpOnlyAfterTheWholeWindowOfContinuousFailure() {
        OutageTracker t = new OutageTracker(OutageTracker.GIVE_UP_AFTER_MS);
        long now = 1_000;
        assertFalse(t.observe(false, now));
        assertFalse(t.observe(false, now + 3 * 60_000));
        assertFalse(t.observe(false, now + 10 * 60_000 - 1));
        assertTrue(t.observe(false, now + 10 * 60_000));
    }

    @Test
    public void theWindowIsLongerThanThreeMinutes() {
        assertTrue(OutageTracker.GIVE_UP_AFTER_MS >= 3 * 60_000);
    }

    @Test
    public void anyAnswerStartsTheWindowOver() {
        OutageTracker t = new OutageTracker(60_000);
        assertFalse(t.observe(false, 0));
        assertFalse(t.observe(false, 59_000));
        assertFalse(t.observe(true, 59_500)); // the server answered
        assertFalse(t.observe(false, 60_000));
        assertFalse(t.observe(false, 119_000));
        assertTrue(t.observe(false, 120_000));
    }

    // ---- which endings say something ----

    @Test
    public void groupGoneAndRevokedSayYourGroupEnded() {
        assertEquals(ReasonNotice.Kind.GROUP_ENDED, ReasonNotice.forStopReason("group-gone"));
        assertEquals(ReasonNotice.Kind.GROUP_ENDED, ReasonNotice.forStopReason("revoked"));
    }

    @Test
    public void anUnreachableServerGetsItsOwnNotice() {
        assertEquals(ReasonNotice.Kind.UNREACHABLE, ReasonNotice.forStopReason("server-unreachable"));
    }

    @Test
    public void theServerSwitchingItOffGetsItsOwnNotice() {
        assertEquals(ReasonNotice.Kind.DISABLED, ReasonNotice.forStopReason("disabled"));
    }

    @Test
    public void endingsThePersonCausedAreSilent() {
        for (String r : new String[] {"user-stop", "token-expired", "forbidden", "rejected", null}) {
            assertEquals(r, ReasonNotice.Kind.NONE, ReasonNotice.forStopReason(r));
        }
    }
}
