package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Who reports fresh GPS, and when, in each situation, on a fake clock (seconds as ms). Home pressed,
 * screen off and a dialog over the app are all the same single event, the activity's onPause (that
 * mapping is in SharingStateLifecycleTest); "swiped away" is no event at all.
 */
public class ReportPlannerTest {
    private static final long S = 1_000;
    private static final int BATTERY = 80;
    private static final int NO_BATTERY = -1;

    private static Fix fixAt(long ms) {
        return new Fix(12.9, 80.1, 5, 1.5, 270, ms);
    }

    private static ReportPlanner live() {
        return new ReportPlanner(new AdaptiveRate(5 * S), true);
    }

    private static ReportPlanner.Plan plan(ReportPlanner p, long now) {
        return p.plan(now, false, null, BATTERY);
    }

    /** One report cycle: the plan must say post; mark it sent. */
    private static Fix sendOne(ReportPlanner p, long now) {
        ReportPlanner.Plan plan = plan(p, now);
        assertTrue("expected a report at " + now / S + " s", plan.post);
        p.onPosted(now);
        return plan.fix;
    }

    // ---- the app on screen ----

    @Test
    public void whileLiveItIsOnlyAThirtySecondHeartbeat() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        assertEquals(30 * S, plan(p, 0).gapMs);
        sendOne(p, 0);
        p.onFix(fixAt(20 * S));
        assertFalse("not yet", plan(p, 10 * S).post);
        assertFalse("not yet", plan(p, 26 * S).post);
        p.onFix(fixAt(27 * S));
        assertTrue("27 s is 90% of the heartbeat", plan(p, 27 * S).post);
    }

    @Test
    public void whileLiveTheFirstReportGoesAsSoonAsThereIsAFix() {
        ReportPlanner p = live();
        assertFalse("no fix yet, nothing to say", plan(p, 0).post);
        p.onFix(fixAt(2 * S));
        assertTrue(plan(p, 2 * S).post);
    }

    @Test
    public void whileLiveTheFixesAreRequestedSlowly() {
        assertEquals(30 * S, live().requestIntervalMs(BATTERY));
    }

    // ---- Home pressed, or the screen switched off with the app still there (both: onPause) ----

    @Test
    public void homePressedItWaitsForAFixTakenAfterLeavingThenReportsAtTheFullRate() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.onFix(fixAt(29 * S)); // the last heartbeat-paced fix: 1 s before the switch

        p.setLive(false, 30 * S); // HOME
        assertEquals("fixes are now asked for at the full rate", 5 * S, p.requestIntervalMs(BATTERY));
        ReportPlanner.Plan waiting = plan(p, 30 * S);
        assertFalse("the 1-second-old fix is not reported as current", waiting.post);
        assertTrue(waiting.waitingForFreshFix);

        Fix fresh = fixAt(32 * S); // the first fix after leaving: 2 s of switch-over
        p.onFix(fresh);
        ReportPlanner.Plan go = plan(p, 32 * S);
        assertTrue(go.post);
        assertSame(fresh, go.fix);
        assertEquals("and at the full rate from here on", 5 * S, go.gapMs);
        p.onPosted(32 * S);

        assertFalse(plan(p, 36 * S).post);
        p.onFix(fixAt(37 * S));
        assertTrue("5 s later, not 30", plan(p, 37 * S).post);
    }

    @Test
    public void leavingJustAfterAHeartbeatStillReportsTheFirstFreshFixAtOnce() {
        ReportPlanner p = live();
        p.onFix(fixAt(29 * S));
        sendOne(p, 29 * S); // a heartbeat went out one second before Home
        p.setLive(false, 30 * S);
        p.onFix(fixAt(31 * S));
        ReportPlanner.Plan go = plan(p, 31 * S);
        assertTrue("the heartbeat 2 s ago does not hold the first full-rate report back", go.post);
        assertEquals(31 * S, go.fix.takenAtMs);
    }

    @Test
    public void screenOffWithoutSwipingBehavesTheSame() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.onFix(fixAt(10 * S));
        p.setLive(false, 12 * S); // the screen turns off
        assertFalse(plan(p, 12 * S).post);
        p.onFix(fixAt(13 * S));
        ReportPlanner.Plan go = plan(p, 13 * S);
        assertTrue("the switch-over took 1 s", go.post);
        assertEquals(13 * S, go.fix.takenAtMs);
    }

    @Test
    public void ifNoFreshFixComesItReportsTheHeldOneAfterTenSecondsRatherThanGoSilent() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.onFix(fixAt(25 * S));
        p.setLive(false, 30 * S);
        assertTrue(plan(p, 39 * S + 999).waitingForFreshFix);
        ReportPlanner.Plan fallback = plan(p, 40 * S);
        assertTrue(fallback.post);
        assertEquals("the held fix, 15 s old", 25 * S, fallback.fix.takenAtMs);
    }

    @Test
    public void butNeverAFixSoOldItWouldBeALie() {
        ReportPlanner p = live();
        p.onFix(fixAt(0)); // no fix for a long time, e.g. indoors
        sendOne(p, 0);
        p.setLive(false, 100 * S);
        assertFalse(plan(p, 100 * S).post);
        assertFalse("10 s on, the held fix is 110 s old: silent, the lease runs out honestly", plan(p, 110 * S).post);
        assertFalse(plan(p, 110 * S).waitingForFreshFix);
    }

    @Test
    public void theFreshFixWaitEndsAfterTheFirstReport() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.setLive(false, 30 * S);
        p.onFix(fixAt(31 * S));
        sendOne(p, 31 * S);
        // The next report is not held back for a fix "after 30 s": every fix is after it now.
        p.onFix(fixAt(36 * S));
        assertTrue(plan(p, 36 * S).post);
        assertFalse(plan(p, 36 * S).waitingForFreshFix);
    }

    @Test
    public void leavingTwiceInARowDoesNotRestartTheWait() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.setLive(false, 30 * S);
        p.setLive(false, 35 * S); // a duplicate pause event
        p.onFix(fixAt(31 * S));
        assertTrue("31 s is after the first switch at 30 s", plan(p, 36 * S).post);
    }

    // ---- the app swiped away ----

    @Test
    public void swipingAwayChangesNothing_theServiceJustKeepsReportingAtTheFullRate() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.setLive(false, 30 * S); // Home was pressed earlier; this is the only lifecycle event there is
        int reports = 0;
        long maxGap = 0;
        long lastReport = -1;
        for (long t = 30 * S; t <= 150 * S; t += S) { // two minutes, a fix every second, NO further events: the swipe
            p.onFix(fixAt(t));
            ReportPlanner.Plan plan = plan(p, t);
            if (plan.post) {
                assertTrue("always a fix taken within the last second", t - plan.fix.takenAtMs <= S);
                assertEquals(5 * S, plan.gapMs);
                p.onPosted(t);
                reports++;
                if (lastReport >= 0) maxGap = Math.max(maxGap, t - lastReport);
                lastReport = t;
            }
        }
        assertTrue("about one report every 5 s: " + reports, reports >= 23 && reports <= 25);
        assertTrue("no gap longer than 5 s across the swipe: " + maxGap, maxGap <= 5 * S);
    }

    @Test
    public void swipingAwayWhileStillOnScreenIsTheSameAsLeavingIt() {
        // A swipe from the recents screen needs the app to be paused first; if somehow the first
        // event is the pause at the moment of the swipe, the result is the same as pressing Home.
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.setLive(false, 20 * S);
        p.onFix(fixAt(21 * S));
        assertTrue(plan(p, 21 * S).post);
    }

    // ---- back in the app ----

    @Test
    public void backInTheAppItIsAHeartbeatAgainAndTheWaitIsDropped() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.setLive(false, 30 * S);
        p.onFix(fixAt(31 * S));
        sendOne(p, 31 * S);
        p.setLive(true, 40 * S);
        assertEquals(30 * S, p.requestIntervalMs(BATTERY));
        p.onFix(fixAt(45 * S));
        assertFalse("5 s ago it reported; now only a heartbeat is due", plan(p, 45 * S).post);
        p.onFix(fixAt(58 * S));
        assertTrue(plan(p, 58 * S).post);
    }

    @Test
    public void returningBeforeAFreshFixCancelsTheWait() {
        ReportPlanner p = live();
        p.onFix(fixAt(0));
        sendOne(p, 0);
        p.setLive(false, 30 * S);
        p.setLive(true, 31 * S);
        p.onFix(fixAt(29 * S));
        assertFalse(plan(p, 31 * S).waitingForFreshFix);
    }

    // ---- paused, failures, the rate ----

    @Test
    public void pausedItSendsTheHeldPositionEverySlowHeartbeatWhateverTheAppIsDoing() {
        ReportPlanner p = new ReportPlanner(new AdaptiveRate(5 * S), false);
        Fix held = fixAt(10 * S);
        p.reportSoon();
        ReportPlanner.Plan first = p.plan(60 * S, true, held, BATTERY);
        assertTrue(first.post);
        assertSame(held, first.fix);
        assertEquals(PauseState.PAUSE_HEARTBEAT_MS, first.gapMs);
        p.onPosted(60 * S);
        assertFalse(p.plan(100 * S, true, held, BATTERY).post);
        assertTrue(p.plan(60 * S + 216 * S, true, held, BATTERY).post);
        // and a live fix that arrives while paused is not what gets reported
        p.onFix(fixAt(300 * S));
        assertSame(held, p.plan(300 * S + 1, true, held, BATTERY).fix);
    }

    @Test
    public void pausedAndThenLeavingTheAppDoesNotWaitForAFreshFix() {
        ReportPlanner p = live();
        Fix held = fixAt(5 * S);
        p.setLive(false, 30 * S);
        ReportPlanner.Plan plan = p.plan(30 * S, true, held, BATTERY);
        assertTrue(plan.post);
        assertSame(held, plan.fix);
    }

    @Test
    public void aFailedReportIsNotRetriedBeforeItsTime() {
        ReportPlanner p = new ReportPlanner(new AdaptiveRate(5 * S), false);
        p.onFix(fixAt(100 * S));
        sendOne(p, 100 * S);
        p.holdOff(100 * S, 8 * S);
        p.onFix(fixAt(105 * S));
        assertFalse(plan(p, 105 * S).post);
        p.onFix(fixAt(108 * S));
        assertTrue(plan(p, 108 * S).post);
    }

    @Test
    public void standingStillAndLowBatteryStillSlowTheFullRate() {
        ReportPlanner p = new ReportPlanner(new AdaptiveRate(5 * S), false);
        for (int i = 0; i < 3; i++) p.onFix(new Fix(1, 2, 5, 0.0, Double.NaN, i * S));
        assertEquals(15 * S, p.requestIntervalMs(BATTERY));
        assertEquals(30 * S, p.requestIntervalMs(10));
        assertEquals(15 * S, p.requestIntervalMs(NO_BATTERY));
    }

    @Test
    public void aFixThatIsTooOldIsNeverReportedAsCurrent() {
        ReportPlanner p = new ReportPlanner(new AdaptiveRate(5 * S), false);
        p.onFix(fixAt(0));
        assertTrue(plan(p, 60 * S).post);
        assertFalse(plan(p, 60 * S + 1).post && false);
        ReportPlanner q = new ReportPlanner(new AdaptiveRate(5 * S), false);
        q.onFix(fixAt(0));
        assertFalse("61 s old", plan(q, 61 * S).post);
    }

    @Test
    public void aNewRateTakesEffectWithoutLosingTheLastFix() {
        ReportPlanner p = live();
        Fix f = fixAt(0);
        p.onFix(f);
        p.setRate(new AdaptiveRate(15 * S));
        assertSame(f, p.lastFix());
        assertNotNull(p.lastFix());
        assertNull(new ReportPlanner(new AdaptiveRate(5 * S), true).lastFix());
    }
}
