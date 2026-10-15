package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PauseStateTest {
    private static final long T0 = 1_000_000;
    private static final Fix HERE = new Fix(12.82, 80.04, 8, 0, Double.NaN, T0);

    @Test
    public void startsActive() {
        PauseState p = new PauseState();
        assertFalse(p.isPaused(T0));
        assertEquals("ACTIVE", p.status(T0));
        assertNull(p.held());
        assertEquals(-1, p.remainingMs(T0));
    }

    @Test
    public void pausingHoldsThePositionAndSaysFrozen() {
        PauseState p = new PauseState();
        p.pause(15 * 60_000L, T0, HERE);
        assertTrue(p.isPaused(T0));
        assertEquals("FROZEN", p.status(T0 + 1));
        assertSame(HERE, p.held());
        assertEquals(15 * 60_000L, p.remainingMs(T0));
    }

    @Test
    public void aTimedPauseEndsItselfExactlyWhenItRunsOut() {
        PauseState p = new PauseState();
        p.pause(60_000, T0, HERE);
        assertTrue(p.isPaused(T0 + 59_999));
        assertFalse(p.isPaused(T0 + 60_000));
        assertEquals("ACTIVE", p.status(T0 + 60_000));
        assertNull(p.held()); // and the held position is let go
        assertFalse(p.isPaused(T0 + 61_000)); // and stays ended
    }

    @Test
    public void untilResumedNeverRunsOut() {
        PauseState p = new PauseState();
        p.pause(0, T0, HERE);
        assertTrue(p.isPaused(T0 + 10L * 24 * 3600_000));
        assertEquals(-1, p.remainingMs(T0 + 5));
        p.resume();
        assertFalse(p.isPaused(T0 + 5));
    }

    @Test
    public void aNegativeDurationIsAlsoUntilResumed() {
        PauseState p = new PauseState();
        p.pause(-5, T0, HERE);
        assertTrue(p.isPaused(T0 + 1_000_000));
    }

    @Test
    public void aTimedPauseIsCappedAtADay() {
        PauseState p = new PauseState();
        p.pause(1000L * 24 * 3600_000, T0, HERE);
        assertTrue(p.isPaused(T0 + PauseState.MAX_PAUSE_MS - 1));
        assertFalse(p.isPaused(T0 + PauseState.MAX_PAUSE_MS));
    }

    @Test
    public void resumingClearsEverything() {
        PauseState p = new PauseState();
        p.pause(60_000, T0, HERE);
        p.resume();
        assertFalse(p.isPaused(T0));
        assertNull(p.held());
        assertEquals("ACTIVE", p.status(T0));
    }

    @Test
    public void pausingBeforeAnyFixHoldsNothing() {
        PauseState p = new PauseState();
        p.pause(60_000, T0, null);
        assertTrue(p.isPaused(T0));
        assertNull(p.held());
    }

    @Test
    public void pausingAgainReplacesThePause() {
        PauseState p = new PauseState();
        p.pause(60_000, T0, HERE);
        Fix later = new Fix(1, 2, 3, 4, 5, T0 + 30_000);
        p.pause(120_000, T0 + 30_000, later);
        assertTrue(p.isPaused(T0 + 100_000));
        assertSame(later, p.held());
    }

    @Test
    public void theHeartbeatWhilePausedKeepsTheServersLeaseAlive() {
        // 240 s promised -> the server holds the place for 720 s, inside its 900 s ceiling.
        assertTrue(3 * AdaptiveRate.nextPostWithinSec(PauseState.PAUSE_HEARTBEAT_MS) <= 900);
    }
}
