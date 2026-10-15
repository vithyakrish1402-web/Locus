package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class BackoffAndResponseTest {
    private static Backoff steady(double random) {
        return new Backoff(() -> random);
    }

    // ---- backoff ----

    @Test
    public void doublesFromTwoSecondsUpToFiveMinutes() {
        Backoff b = steady(0.5); // no jitter
        long[] expected = {2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000};
        for (long e : expected) assertEquals(e, b.next());
    }

    @Test
    public void jitterStaysWithinTwentyPercent() {
        assertEquals(1_600, steady(0.0).next());
        assertEquals(2_400, new Backoff(() -> 0.999999).next(), 1);
        for (double r = 0; r < 1; r += 0.1) {
            long wait = steady(r).next();
            assertTrue(wait >= 1_600 && wait <= 2_400);
        }
    }

    @Test
    public void aSuccessStartsItOver() {
        Backoff b = steady(0.5);
        b.next();
        b.next();
        b.next();
        b.reset();
        assertEquals(2_000, b.next());
    }

    @Test
    public void neverOverflowsAfterManyFailures() {
        Backoff b = steady(0.5);
        for (int i = 0; i < 1_000; i++) assertTrue(b.next() <= Backoff.CAP_MS);
    }

    @Test
    public void whenTheServerSaysWhenToComeBackThatIsObeyedWithinReason() {
        assertEquals(30_000, Backoff.retryAfterMs(30));
        assertEquals(1_000, Backoff.retryAfterMs(0));
        assertEquals(1_000, Backoff.retryAfterMs(-4));
        assertEquals(900_000, Backoff.retryAfterMs(86_400));
    }

    // ---- what to do with an answer ----

    private static Outcome answer(int status, String body, long retryAfter) {
        return ResponseHandler.forLocation(new HttpResult(status, body, retryAfter, false), steady(0.5));
    }

    private static void assertStop(String reason, Outcome o) {
        assertEquals(Outcome.Action.STOP, o.action);
        assertEquals(reason, o.stopReason);
    }

    @Test
    public void okCarriesOnAndResetsTheBackoff() {
        Backoff b = steady(0.5);
        b.next();
        b.next();
        Outcome o = ResponseHandler.forLocation(new HttpResult(200, "{\"ok\":true}", 0, false), b);
        assertEquals(Outcome.Action.CONTINUE, o.action);
        assertEquals(2_000, b.next());
    }

    @Test
    public void noAnswerAndServerErrorsRetryWithBackoff() {
        Backoff b = steady(0.5);
        Outcome none = ResponseHandler.forLocation(HttpResult.noAnswer(), b);
        assertEquals(Outcome.Action.RETRY, none.action);
        assertEquals(2_000, none.delayMs);
        assertEquals(4_000, ResponseHandler.forLocation(new HttpResult(500, "", 0, false), b).delayMs);
        assertEquals(8_000, ResponseHandler.forLocation(new HttpResult(502, "", 0, false), b).delayMs);
        assertEquals(16_000, ResponseHandler.forLocation(new HttpResult(503, "{\"error\":\"identity-unavailable\"}", 0, false), b).delayMs);
    }

    @Test
    public void tooManyRequestsWaitsAsLongAsTheServerSaysOrAMinute() {
        Outcome told = answer(429, "{\"error\":\"rate-limited\"}", 17);
        assertEquals(Outcome.Action.RETRY, told.action);
        assertEquals(17_000, told.delayMs);
        assertEquals(60_000, answer(429, "", 0).delayMs);
    }

    @Test
    public void aRefusedReportIsDroppedAndTheNextOneSent() {
        assertEquals(Outcome.Action.DROP, answer(400, "{\"error\":\"bad-request\",\"field\":\"lat\"}", 0).action);
        assertEquals(Outcome.Action.DROP, answer(413, "", 0).action);
    }

    @Test
    public void aFinishedPassStopsSharingAndSaysWhy() {
        assertStop(ResponseHandler.REVOKED, answer(401, "{\"error\":\"invalid-token\",\"reason\":\"revoked\"}", 0));
        assertStop(ResponseHandler.TOKEN_EXPIRED, answer(401, "{\"error\":\"invalid-token\",\"reason\":\"expired\"}", 0));
        assertStop(ResponseHandler.REVOKED, answer(401, "{\"error\":\"missing-token\"}", 0));
        assertStop(ResponseHandler.REVOKED, answer(401, "", 0));
    }

    @Test
    public void noLongerAMemberStopsSharing() {
        assertStop(ResponseHandler.FORBIDDEN, answer(403, "{\"error\":\"not-member\"}", 0));
        assertStop(ResponseHandler.FORBIDDEN, answer(403, "{\"error\":\"blocked\"}", 0));
    }

    @Test
    public void aGoneGroupStopsSharing() {
        assertStop(ResponseHandler.GROUP_GONE, answer(410, "{\"error\":\"no-group\"}", 0));
    }

    @Test
    public void aServerThatSwitchedSharingOffStopsItButAnOutageDoesNot() {
        assertStop(ResponseHandler.DISABLED, answer(503, "{\"error\":\"disabled\"}", 0));
        assertEquals(Outcome.Action.RETRY, answer(503, "", 0).action);
        assertEquals(Outcome.Action.RETRY, answer(503, "Service Unavailable", 0).action);
    }

    @Test
    public void aServerThatDoesNotKnowTheAddressStopsSharing() {
        assertStop(ResponseHandler.REJECTED, answer(404, "", 0));
        assertStop(ResponseHandler.REJECTED, answer(302, "", 0)); // a redirect is never followed
        assertStop(ResponseHandler.REJECTED, answer(418, "", 0));
    }

    @Test
    public void everyStopCarriesAReasonAndNothingElseDoes() {
        int[] statuses = {0, 200, 201, 301, 400, 401, 403, 404, 410, 413, 429, 500, 502, 503};
        for (int s : statuses) {
            Outcome o = answer(s, "", 0);
            if (o.action == Outcome.Action.STOP) assertTrue(s + " has a reason", o.stopReason != null && !o.stopReason.isEmpty());
            else assertNull(s + " has none", o.stopReason);
        }
    }
}
