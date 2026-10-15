package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AdaptiveRateTest {
    private static final int NO_BATTERY_INFO = -1;

    private static AdaptiveRate movingAt(long pollingMs) {
        AdaptiveRate r = new AdaptiveRate(pollingMs);
        r.onFix(1.4);
        return r;
    }

    private static void standStill(AdaptiveRate r, int fixes) {
        for (int i = 0; i < fixes; i++) r.onFix(0.0);
    }

    @Test
    public void usesTheSettingsChoiceAsTheBase() {
        assertEquals(15_000, movingAt(15_000).intervalMs(false, 80));
        assertEquals(5_000, movingAt(5_000).intervalMs(false, 80));
        assertEquals(1_000, movingAt(1_000).intervalMs(false, 80));
    }

    @Test
    public void clampsAnAbsurdBase() {
        assertEquals(1_000, new AdaptiveRate(0).intervalMs(false, 80));
        assertEquals(1_000, new AdaptiveRate(-5).intervalMs(false, 80));
        assertEquals(AdaptiveRate.MAX_INTERVAL_MS, new AdaptiveRate(10_000_000).intervalMs(false, 80));
    }

    @Test
    public void standingStillReportsThreeTimesLessOftenAfterThreeSlowFixes() {
        AdaptiveRate r = movingAt(5_000);
        standStill(r, 2);
        assertFalse(r.isStationary());
        assertEquals(5_000, r.intervalMs(false, 80));
        standStill(r, 1);
        assertTrue(r.isStationary());
        assertEquals(15_000, r.intervalMs(false, 80));
    }

    @Test
    public void movingAgainSnapsBackAtOnce() {
        AdaptiveRate r = movingAt(5_000);
        standStill(r, 10);
        assertEquals(15_000, r.intervalMs(false, 80));
        r.onFix(1.4);
        assertEquals(5_000, r.intervalMs(false, 80));
        standStill(r, 2); // a single moving fix restarted the count
        assertEquals(5_000, r.intervalMs(false, 80));
    }

    @Test
    public void theBoundaryOfStandingStillIsExact() {
        AdaptiveRate r = movingAt(5_000);
        r.onFix(AdaptiveRate.STATIONARY_MPS); // exactly the limit counts as moving
        r.onFix(AdaptiveRate.STATIONARY_MPS);
        r.onFix(AdaptiveRate.STATIONARY_MPS);
        assertFalse(r.isStationary());
        for (int i = 0; i < 3; i++) r.onFix(AdaptiveRate.STATIONARY_MPS - 0.01);
        assertTrue(r.isStationary());
    }

    @Test
    public void aFixWithNoSpeedSaysNothingEitherWay() {
        AdaptiveRate r = movingAt(5_000);
        standStill(r, 3);
        r.onFix(Double.NaN);
        r.onFix(-1);
        assertTrue(r.isStationary());
        AdaptiveRate fresh = new AdaptiveRate(5_000);
        for (int i = 0; i < 10; i++) fresh.onFix(Double.NaN);
        assertFalse(fresh.isStationary());
    }

    @Test
    public void aLowBatteryReportsHalfAsOften() {
        AdaptiveRate r = movingAt(5_000);
        assertEquals(10_000, r.intervalMs(false, 15));
        assertEquals(10_000, r.intervalMs(false, 1));
        assertEquals(5_000, r.intervalMs(false, 16));
        assertEquals(5_000, r.intervalMs(false, NO_BATTERY_INFO));
    }

    @Test
    public void stillAndLowBatteryCompoundButNeverPastTheCeiling() {
        AdaptiveRate r = movingAt(5_000);
        standStill(r, 3);
        assertEquals(30_000, r.intervalMs(false, 10));
        AdaptiveRate slow = movingAt(15_000);
        standStill(slow, 3);
        assertEquals(90_000, slow.intervalMs(false, 10)); // 15 x 3 x 2 = 90 s, still under the cap
        AdaptiveRate slowest = movingAt(60_000);
        standStill(slowest, 3);
        assertEquals(AdaptiveRate.MAX_INTERVAL_MS, slowest.intervalMs(false, 10)); // 360 s, capped
    }

    @Test
    public void withTheAppOnScreenItIsAHeartbeatWhateverElseIsTrue() {
        AdaptiveRate r = movingAt(1_000);
        assertEquals(AdaptiveRate.VISIBLE_HEARTBEAT_MS, r.intervalMs(true, 80));
        standStill(r, 5);
        assertEquals(AdaptiveRate.VISIBLE_HEARTBEAT_MS, r.intervalMs(true, 5));
    }

    @Test
    public void theInternalCeilingIsAboveEverythingTheBaseCanBe() {
        AdaptiveRate r = movingAt(15_000);
        assertTrue(r.intervalMs(false, 80) < AdaptiveRate.MAX_INTERVAL_MS);
    }

    @Test
    public void whatEachReportPromisesIsWholeSecondsRoundedUpWithinWhatTheServerTakes() {
        assertEquals(1, AdaptiveRate.nextPostWithinSec(1));
        assertEquals(1, AdaptiveRate.nextPostWithinSec(1_000));
        assertEquals(2, AdaptiveRate.nextPostWithinSec(1_001));
        assertEquals(5, AdaptiveRate.nextPostWithinSec(5_000));
        assertEquals(15, AdaptiveRate.nextPostWithinSec(14_001));
        assertEquals(30, AdaptiveRate.nextPostWithinSec(AdaptiveRate.VISIBLE_HEARTBEAT_MS));
        assertEquals(120, AdaptiveRate.nextPostWithinSec(AdaptiveRate.MAX_INTERVAL_MS));
        assertEquals(240, AdaptiveRate.nextPostWithinSec(PauseState.PAUSE_HEARTBEAT_MS));
        assertEquals(300, AdaptiveRate.nextPostWithinSec(10_000_000));
        assertEquals(1, AdaptiveRate.nextPostWithinSec(0));
        assertEquals(1, AdaptiveRate.nextPostWithinSec(-9));
    }

    @Test
    public void thePromiseNeverExceedsTheLongestLeaseTheServerGrants() {
        // The server holds a place for three times the promise, up to 900 s. 300 x 3 = 900.
        assertTrue(3 * AdaptiveRate.nextPostWithinSec(Long.MAX_VALUE / 2) <= 900);
    }
}
