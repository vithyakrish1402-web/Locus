package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

/**
 * The "is the app live" counter that MainActivity feeds from onResume and onPause. Home, the screen
 * going off, split screen and a dialog over the app all end in one onPause; a swipe adds nothing.
 */
public class SharingStateLifecycleTest {
    private final List<Boolean> events = new ArrayList<>();

    @Before
    public void listen() {
        while (SharingState.isAppLive()) SharingState.activityPaused(); // a clean slate: the state is static
        events.clear();
        SharingState.setLiveListener(events::add);
    }

    @After
    public void stopListening() {
        SharingState.setLiveListener(null);
        while (SharingState.isAppLive()) SharingState.activityPaused();
    }

    @Test
    public void startsNotLive() {
        assertFalse(SharingState.isAppLive());
    }

    @Test
    public void resumingMakesItLiveAndPausingMakesItNotLive_onceEach() {
        SharingState.activityResumed();
        assertTrue(SharingState.isAppLive());
        SharingState.activityPaused(); // Home, screen off, split screen, a dialog: all just this
        assertFalse(SharingState.isAppLive());
        assertEquals(java.util.Arrays.asList(true, false), events);
    }

    @Test
    public void theFollowingStopAndDestroyOfASwipeAddNothing() {
        SharingState.activityResumed();
        SharingState.activityPaused();
        // onStop, onDestroy and the task being removed are not reported at all: nothing to call.
        assertEquals(java.util.Arrays.asList(true, false), events);
        assertFalse(SharingState.isAppLive());
    }

    @Test
    public void aPauseWithoutAResumeNeverGoesNegative() {
        SharingState.activityPaused();
        SharingState.activityPaused();
        assertFalse(SharingState.isAppLive());
        assertTrue("and no event for a pause that changed nothing", events.isEmpty());
        SharingState.activityResumed();
        assertTrue("one resume is enough to be live", SharingState.isAppLive());
    }

    @Test
    public void twoActivitiesOverlappingKeepItLiveUntilTheLastIsPaused() {
        SharingState.activityResumed();
        SharingState.activityResumed(); // a recreated activity resumes before the old one pauses
        SharingState.activityPaused();
        assertTrue(SharingState.isAppLive());
        assertEquals("one event, not two", java.util.Arrays.asList(true), events);
        SharingState.activityPaused();
        assertFalse(SharingState.isAppLive());
        assertEquals(java.util.Arrays.asList(true, false), events);
    }

    @Test
    public void onlyTransitionsAreReported() {
        SharingState.activityResumed();
        SharingState.activityResumed();
        SharingState.activityPaused();
        SharingState.activityResumed();
        SharingState.activityPaused();
        SharingState.activityPaused();
        assertEquals(java.util.Arrays.asList(true, false), events);
    }

    @Test
    public void withNoListenerNothingBreaks() {
        SharingState.setLiveListener(null);
        SharingState.activityResumed();
        SharingState.activityPaused();
        assertFalse(SharingState.isAppLive());
    }
}
