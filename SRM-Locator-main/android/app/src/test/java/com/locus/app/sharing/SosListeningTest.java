package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.List;
import java.util.Map;
import org.junit.Test;

public class SosListeningTest {
    // ---- the JSON reader ----

    @Test
    public void readsWhatTheServerSends() {
        Object v = MiniJson.parse("{\"a\":[1,2.5,-3e2],\"b\":\"x\\u00e9\\n\\\"q\\\"\",\"c\":null,\"d\":true,\"e\":{}}");
        Map<?, ?> m = (Map<?, ?>) v;
        assertEquals(3, ((List<?>) m.get("a")).size());
        assertEquals(-300.0, (Double) ((List<?>) m.get("a")).get(2), 0);
        assertEquals("x\u00e9\n\"q\"", m.get("b"));
        assertNull(m.get("c"));
        assertEquals(Boolean.TRUE, m.get("d"));
    }

    @Test
    public void refusesAnythingThatIsNotExactlyOneJsonValue() {
        String[] bad = {"", "{", "{\"a\":1", "{\"a\":1}x", "[1,]", "{\"a\"}", "{'a':1}", "\"abc", "tru", "1.", "-", "\"\\q\"", "\"\\u12\"",
            "{\"a\":1,}", "nul", "\"a\nb\"", "[1 2]"};
        for (String s : bad) {
            try {
                MiniJson.parse(s);
                fail("accepted: " + s);
            } catch (IllegalArgumentException expected) {
                // refused
            }
        }
    }

    @Test
    public void refusesTooDeepAndTooLong() {
        StringBuilder deep = new StringBuilder();
        for (int i = 0; i < 50; i++) deep.append('[');
        for (int i = 0; i < 50; i++) deep.append(']');
        try {
            MiniJson.parse(deep.toString());
            fail("deep");
        } catch (IllegalArgumentException expected) {
            // refused
        }
        StringBuilder big = new StringBuilder("\"");
        for (int i = 0; i < MiniJson.MAX_LENGTH; i++) big.append('x');
        try {
            MiniJson.parse(big.append('"').toString());
            fail("long");
        } catch (IllegalArgumentException expected) {
            // refused
        }
    }

    // ---- the server's answer ----

    // Exactly the shape backend/backgroundSharing.js sends (tests/sosBackground.integration.test.js drives the real server).
    private static final String ONE = "{\"id\":\"3f1c\",\"senderId\":\"sock1\",\"senderName\":\"Asha\",\"lat\":12.8231,\"lng\":80.0442,"
        + "\"timestamp\":1760000000000,\"ageMs\":2500,\"senderUid\":\"uA\",\"rev\":4}";

    private static String answer(String sos, long rev) {
        return "{\"sos\":[" + sos + "],\"rev\":" + rev + ",\"serverTime\":1760000002500}";
    }

    @Test
    public void understandsAnAnswerWithAnSos() {
        SosAlert.Poll poll = SosAlert.parsePoll(answer(ONE, 4));
        assertNotNull(poll);
        assertEquals(4, poll.rev);
        assertEquals(1, poll.alerts.size());
        SosAlert a = poll.alerts.get(0);
        assertEquals("3f1c", a.id);
        assertEquals("uA", a.senderUid);
        assertEquals("Asha", a.senderName);
        assertEquals(12.8231, a.lat, 0);
        assertEquals(80.0442, a.lng, 0);
        assertEquals(2500, a.ageMs);
        assertEquals(4, a.rev);
        assertTrue(a.hasLocation());
    }

    @Test
    public void anEmptyAnswerIsFineAndCarriesTheRev() {
        SosAlert.Poll poll = SosAlert.parsePoll("{\"sos\":[],\"rev\":9,\"serverTime\":1}");
        assertNotNull(poll);
        assertTrue(poll.alerts.isEmpty());
        assertEquals(9, poll.rev);
    }

    @Test
    public void anAlertWithoutALocationOrNameStillComes() {
        String bare = "{\"id\":\"x\",\"senderUid\":\"uB\",\"rev\":1,\"lat\":null,\"lng\":null,\"senderName\":null,\"ageMs\":0,\"timestamp\":0}";
        SosAlert a = SosAlert.parsePoll(answer(bare, 1)).alerts.get(0);
        assertFalse(a.hasLocation());
        assertNull(a.senderName);
    }

    @Test
    public void aLocationOutOfRangeIsNoLocation() {
        String off = "{\"id\":\"x\",\"senderUid\":\"uB\",\"rev\":1,\"lat\":91,\"lng\":10,\"ageMs\":0,\"timestamp\":0}";
        assertFalse(SosAlert.parsePoll(answer(off, 1)).alerts.get(0).hasLocation());
    }

    @Test
    public void aNameIsCleanedAndShortened() {
        assertEquals("Asha", SosAlert.cleanName("  Asha\u0007 "));
        assertNull(SosAlert.cleanName("   "));
        assertNull(SosAlert.cleanName(null));
        assertNull(SosAlert.cleanName(5.0));
        StringBuilder long80 = new StringBuilder();
        for (int i = 0; i < 80; i++) long80.append('n');
        assertEquals(SosAlert.MAX_NAME, SosAlert.cleanName(long80.toString()).length());
    }

    @Test
    public void anAnswerThatIsNotUnderstoodIsNeverHalfBelieved() {
        String[] bad = {
            null, "", "nonsense", "[]", "{}", "{\"sos\":[]}", "{\"rev\":1}", "{\"sos\":{},\"rev\":1}", "{\"sos\":[],\"rev\":-1}", "{\"sos\":[],\"rev\":\"1\"}",
            answer(ONE, 4).substring(0, 40), // cut off
            answer("{\"senderUid\":\"uA\",\"rev\":1}", 1), // no id
            answer("{\"id\":\"x\",\"rev\":1}", 1), // no sender
            answer("{\"id\":\"x\",\"senderUid\":\"uA\"}", 1), // no rev
            answer("5", 1),
            answer(ONE + ",{\"id\":\"y\"}", 5), // one bad entry among good ones
        };
        for (String body : bad) assertNull(String.valueOf(body), SosAlert.parsePoll(body));
    }

    // ---- what to do with an answer ----

    private static Backoff steady() {
        return new Backoff(() -> 0.5, 2_000, 30_000);
    }

    private static SosPollHandler.Next next(int status, String body, long retryAfter, boolean networkError) {
        return SosPollHandler.forPoll(new HttpResult(status, body, retryAfter, networkError), steady());
    }

    @Test
    public void anUnderstoodAnswerIsDeliveredAndAskedAgainFromItsRev() {
        SosPollHandler.Next n = next(200, answer(ONE, 4), 0, false);
        assertEquals(SosPollHandler.Next.Action.DELIVER, n.action);
        assertEquals(4, n.rev);
        assertEquals(1, n.alerts.size());
    }

    @Test
    public void aGarbledAnswerWaitsAndAsksAgain() {
        SosPollHandler.Next n = next(200, "{\"sos\":[{", 0, false);
        assertEquals(SosPollHandler.Next.Action.WAIT, n.action);
        assertEquals(2_000, n.delayMs);
    }

    @Test
    public void noAnswerAndServerTroubleBackOffFromTwoSecondsToThirty() {
        Backoff b = steady();
        long[] expected = {2_000, 4_000, 8_000, 16_000, 30_000, 30_000};
        for (long e : expected) {
            SosPollHandler.Next n = SosPollHandler.forPoll(HttpResult.noAnswer(), b);
            assertEquals(SosPollHandler.Next.Action.WAIT, n.action);
            assertEquals(e, n.delayMs);
        }
        assertEquals(SosPollHandler.Next.Action.WAIT, SosPollHandler.forPoll(new HttpResult(503, "", 0, false), b).action);
        assertEquals(SosPollHandler.Next.Action.WAIT, SosPollHandler.forPoll(new HttpResult(502, "", 0, false), b).action);
    }

    @Test
    public void aGoodAnswerStartsTheBackoffOver() {
        Backoff b = steady();
        SosPollHandler.forPoll(HttpResult.noAnswer(), b);
        SosPollHandler.forPoll(HttpResult.noAnswer(), b);
        SosPollHandler.forPoll(new HttpResult(200, answer("", 0), 0, false), b);
        assertEquals(2_000, SosPollHandler.forPoll(HttpResult.noAnswer(), b).delayMs);
    }

    @Test
    public void tooManyQuestionsWaitsAsTheServerSays() {
        assertEquals(17_000, next(429, "", 17, false).delayMs);
        assertEquals(30_000, next(429, "", 0, false).delayMs);
    }

    @Test
    public void aRefusalThatMayPassIsWaitedOutNotGivenUpOn() {
        for (int status : new int[] {401, 403, 410}) {
            SosPollHandler.Next n = next(status, "{\"error\":\"x\"}", 0, false);
            assertEquals(SosPollHandler.Next.Action.WAIT, n.action);
            assertEquals(SosPollHandler.REFUSED_WAIT_MS, n.delayMs);
        }
    }

    @Test
    public void aServerThatDoesNotDoThisStopsTheListening() {
        assertEquals(SosPollHandler.Next.Action.STOP, next(404, "", 0, false).action);
        assertEquals(SosPollHandler.Next.Action.STOP, next(400, "", 0, false).action);
        assertEquals(SosPollHandler.Next.Action.STOP, next(302, "", 0, false).action);
    }

    // ---- the backoff the listener uses ----

    @Test
    public void theSosBackoffDoublesFromTwoSecondsAndStopsAtThirty() {
        Backoff b = new Backoff(() -> 0.5, SosListener.SOS_LISTENER_RECONNECT_BACKOFF_BASE_MS, SosListener.SOS_LISTENER_RECONNECT_BACKOFF_CAP_MS);
        long[] expected = {2_000, 4_000, 8_000, 16_000, 30_000, 30_000};
        for (long e : expected) assertEquals(e, b.next());
        for (int i = 0; i < 1_000; i++) assertTrue(b.next() <= 30_000 * 1.2 + 1);
    }

    @Test
    public void theOrdinaryBackoffIsUnchanged() {
        Backoff b = new Backoff(() -> 0.5);
        long[] expected = {2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000};
        for (long e : expected) assertEquals(e, b.next());
    }

    // ---- who gets which notification ----

    private static SosAlert alert(String id, String uid, long rev) {
        return new SosAlert(id, uid, "Asha", 12.8, 80.0, rev, 0, 0);
    }

    @Test
    public void aNewSosWhileTheAppIsClosedRings() {
        SosLedger ledger = new SosLedger();
        SosLedger.Decision d = ledger.decide(alert("s1", "uA", 1), false, true, 1_000);
        assertEquals(SosLedger.Verdict.ALERT, d.verdict);
    }

    @Test
    public void theAppOnScreenHasItsOwnOverlaySoNothingIsRaisedHere() {
        SosLedger ledger = new SosLedger();
        assertEquals(SosLedger.Verdict.IGNORE, ledger.decide(alert("s1", "uA", 1), true, true, 1_000).verdict);
        // ...and once the app is closed, that same SOS does not ring afterwards
        assertEquals(SosLedger.Verdict.IGNORE, ledger.decide(alert("s1", "uA", 1), false, true, 2_000).verdict);
    }

    @Test
    public void anUpdateToAnSosTheAppAloneShowedDoesRingWhenTheAppIsClosed() {
        SosLedger ledger = new SosLedger();
        ledger.decide(alert("s1", "uA", 1), true, true, 1_000); // shown in the app
        // the sender presses again after the app was closed: nobody has been alerted yet, so this one rings
        assertEquals(SosLedger.Verdict.ALERT, ledger.decide(alert("s1", "uA", 2), false, true, 2_000).verdict);
    }

    @Test
    public void turnedOffInSettingsNothingIsRaised() {
        SosLedger ledger = new SosLedger();
        assertEquals(SosLedger.Verdict.IGNORE, ledger.decide(alert("s1", "uA", 1), false, false, 1_000).verdict);
    }

    @Test
    public void theSameAnswerTwiceIsOneAlert() {
        SosLedger ledger = new SosLedger();
        assertEquals(SosLedger.Verdict.ALERT, ledger.decide(alert("s1", "uA", 1), false, true, 1_000).verdict);
        assertEquals(SosLedger.Verdict.IGNORE, ledger.decide(alert("s1", "uA", 1), false, true, 1_500).verdict);
        assertEquals(SosLedger.Verdict.IGNORE, ledger.decide(alert("s1", "uA", 0), false, true, 1_500).verdict);
    }

    @Test
    public void pressingAgainReplacesTheNotificationQuietlyInTheSameSlot() {
        SosLedger ledger = new SosLedger();
        SosLedger.Decision first = ledger.decide(alert("s1", "uA", 1), false, true, 1_000);
        SosLedger.Decision again = ledger.decide(alert("s1", "uA", 2), false, true, 90_000);
        assertEquals(SosLedger.Verdict.UPDATE, again.verdict);
        assertEquals(first.slot, again.slot);
    }

    @Test
    public void aFreshSosFromTheSamePersonSoonAfterIsStillOneAlert() {
        SosLedger ledger = new SosLedger();
        SosLedger.Decision first = ledger.decide(alert("s1", "uA", 1), false, true, 1_000);
        SosLedger.Decision second = ledger.decide(alert("s2", "uA", 2), false, true, 1_000 + SosLedger.SOS_DEDUPE_WINDOW_MS - 1);
        assertEquals(SosLedger.Verdict.UPDATE, second.verdict);
        assertEquals(first.slot, second.slot);
        // a long while later it is a new emergency and rings again
        assertEquals(SosLedger.Verdict.ALERT, ledger.decide(alert("s3", "uA", 3), false, true, 1_000 + 10 * SosLedger.SOS_DEDUPE_WINDOW_MS).verdict);
    }

    @Test
    public void twoPeopleInTroubleGetTwoNotifications() {
        SosLedger ledger = new SosLedger();
        SosLedger.Decision a = ledger.decide(alert("s1", "uA", 1), false, true, 1_000);
        SosLedger.Decision b = ledger.decide(alert("s2", "uB", 2), false, true, 1_100);
        assertEquals(SosLedger.Verdict.ALERT, a.verdict);
        assertEquals(SosLedger.Verdict.ALERT, b.verdict);
        assertTrue(a.slot != b.slot);
    }

    @Test
    public void aNotificationIsFoundByTheSosItShows() {
        SosLedger ledger = new SosLedger();
        assertEquals(-1, ledger.slotOf("nope"));
        SosLedger.Decision d = ledger.decide(alert("s1", "uA", 1), false, true, 1_000);
        assertEquals(d.slot, ledger.slotOf("s1"));
        // one the app showed never had a notification
        ledger.decide(alert("s2", "uB", 1), true, true, 1_000);
        assertEquals(-1, ledger.slotOf("s2"));
    }

    // ---- the words, and the constants ----

    @Test
    public void theNotificationNamesTheSenderAndSaysHowLongAgo() {
        assertEquals("SOS: Asha needs help", SosNotifications.title(alert("s1", "uA", 1)));
        assertEquals("SOS: Someone in your group needs help", SosNotifications.title(new SosAlert("s1", "uA", null, 0, 0, 1, 0, 0)));
        assertEquals("Sent just now", SosNotifications.age(0));
        assertEquals("Sent just now", SosNotifications.age(59_999));
        assertEquals("Sent 1 min ago", SosNotifications.age(60_000));
        assertEquals("Sent 7 min ago", SosNotifications.age(7 * 60_000 + 1));
    }

    @Test
    public void theAssumedConstantsAreWhatTheBriefSuggested() {
        // v2 (2026-10): the channel that may ring through Do Not Disturb; channels are fixed once made.
        assertEquals("locus_sos_alert_v2", SosNotifications.SOS_ALERT_CHANNEL_ID);
        assertEquals(5 * 60 * 1000, SosNotifications.SOS_ALERT_AUTO_TIMEOUT_MS);
        assertEquals(30_000, SosLedger.SOS_DEDUPE_WINDOW_MS);
        assertEquals(2_000, SosListener.SOS_LISTENER_RECONNECT_BACKOFF_BASE_MS);
        assertEquals(30_000, SosListener.SOS_LISTENER_RECONNECT_BACKOFF_CAP_MS);
        // strongly repeating, and not a ping's short buzz: at least three long pulses
        long longPulses = 0;
        for (int i = 1; i < SosNotifications.SOS_VIBRATION_PATTERN.length; i += 2) if (SosNotifications.SOS_VIBRATION_PATTERN[i] >= 800) longPulses++;
        assertTrue(longPulses >= 3);
    }

    @Test
    public void notificationIdsStayClearOfTheSharingOnes() {
        assertTrue(SosNotifications.SOS_ID_BASE > SharingNotifications.ENDED_ID);
        assertTrue(SosNotifications.SOS_ID_BASE > SharingNotifications.RESUME_ID);
    }

    @Test
    public void slotsStayWithinTheirRangeAndMemoryIsBounded() {
        SosLedger ledger = new SosLedger();
        for (int i = 0; i < 500; i++) {
            SosLedger.Decision d = ledger.decide(alert("id" + i, "u" + i, 1), false, true, i * 100_000L);
            assertTrue(d.slot >= 0 && d.slot < SosLedger.SLOTS);
        }
        assertEquals(-1, ledger.slotOf("id0")); // forgotten long ago
        assertTrue(ledger.slotOf("id499") >= 0);
    }
}
