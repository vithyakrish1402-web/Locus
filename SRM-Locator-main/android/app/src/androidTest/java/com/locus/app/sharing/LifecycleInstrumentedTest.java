package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.NotificationManager;
import android.app.UiAutomation;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.location.provider.ProviderProperties;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import androidx.core.content.ContextCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.locus.app.MainActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Who reports fresh GPS, and when, with the REAL MainActivity and the real Home key, screen sleep and
 * task removal, a real foreground service, and a stream of mocked GPS fixes (one every 200 ms, each
 * with its own latitude so the test can tell exactly which fix a report was built from, and how old
 * it was).
 *
 * The switch-over time is measured from the moment the activity is paused (the app stops being "live")
 * to the arrival at the fake server of the first report built from a fix taken AFTER that moment. It is
 * logged under the tag "SwitchOver".
 *
 * A swipe is simulated with finishAndRemoveTask(), which is what a swipe does to the app (the task is
 * removed and the activity destroyed; the foreground service keeps the process alive). The real recents
 * gesture is in BACKGROUND_SHARING_PHONE_TEST.md.
 */
@RunWith(AndroidJUnit4.class)
public class LifecycleInstrumentedTest {
    private static final String TAG = "SwitchOver";
    /** The most a switch-over may take on the emulator, mocked fixes arriving every 200 ms. */
    private static final long MAX_SWITCH_OVER_MS = 5_000;

    private final Context context = ApplicationProvider.getApplicationContext();
    private final UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
    private final LocationManager locations = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
    private final NotificationManager notifications = context.getSystemService(NotificationManager.class);

    private FakeServer server;
    private ActivityScenario<MainActivity> scenario;
    private volatile boolean feeding;
    private Thread feeder;
    private final ConcurrentHashMap<Long, Long> fedAt = new ConcurrentHashMap<>();

    // ---- set-up ----

    private String shell(String command) throws Exception {
        try (ParcelFileDescriptor fd = automation.executeShellCommand(command);
             InputStream in = new java.io.FileInputStream(fd.getFileDescriptor())) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[512];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toString("UTF-8");
        }
    }

    @Before
    public void setUp() throws Exception {
        String pkg = context.getPackageName();
        automation.grantRuntimePermission(pkg, "android.permission.ACCESS_FINE_LOCATION");
        automation.grantRuntimePermission(pkg, "android.permission.POST_NOTIFICATIONS");
        shell("appops set " + pkg + " POST_NOTIFICATION allow");
        shell("appops set " + pkg + " android:mock_location allow");
        shell("input keyevent KEYCODE_WAKEUP");
        shell("wm dismiss-keyguard");
        try {
            locations.removeTestProvider(LocationManager.GPS_PROVIDER);
        } catch (Exception ignored) {
            // none yet
        }
        locations.addTestProvider(LocationManager.GPS_PROVIDER, false, false, false, false, true, true, true,
            ProviderProperties.POWER_USAGE_LOW, ProviderProperties.ACCURACY_FINE);
        locations.setTestProviderEnabled(LocationManager.GPS_PROVIDER, true);
        server = new FakeServer();
        SharingState.forget(context);
        notifications.cancelAll();
        while (SharingState.isAppLive()) SharingState.activityPaused(); // the counter is static; start clean
        startFeeding();
    }

    @After
    public void tearDown() throws Exception {
        feeding = false;
        try {
            context.startService(new Intent(context, LocationShareService.class).setAction(LocationShareService.ACTION_STOP));
        } catch (Exception ignored) {
            // not running
        }
        waitUntil("service to end", 10_000, () -> !LocationShareService.isRunning());
        if (scenario != null) {
            try {
                scenario.close();
            } catch (Exception ignored) {
                // already gone
            }
        }
        SharingState.forget(context);
        server.stop();
        try {
            locations.removeTestProvider(LocationManager.GPS_PROVIDER);
        } catch (Exception ignored) {
            // gone
        }
        shell("input keyevent KEYCODE_WAKEUP");
    }

    // ---- the fix stream ----

    private void startFeeding() {
        feeding = true;
        feeder = new Thread(() -> {
            long seq = 0;
            while (feeding) {
                seq++;
                try {
                    Location l = new Location(LocationManager.GPS_PROVIDER);
                    l.setLatitude(12.9 + seq * 1e-5);
                    l.setLongitude(80.1);
                    l.setAccuracy(5f);
                    l.setSpeed(1.5f);
                    l.setBearing(270f);
                    l.setTime(System.currentTimeMillis());
                    l.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
                    fedAt.put(seq, System.currentTimeMillis());
                    locations.setTestProviderLocation(LocationManager.GPS_PROVIDER, l);
                } catch (Exception ignored) {
                    // the provider is not ready yet, or has gone
                }
                try {
                    Thread.sleep(200);
                } catch (InterruptedException e) {
                    return;
                }
            }
        });
        feeder.setDaemon(true);
        feeder.start();
    }

    /** Which mocked fix a report was built from. */
    private static long seqOf(String request) {
        return Math.round((FakeServer.latOf(request) - 12.9) / 1e-5);
    }

    private interface Condition {
        boolean met() throws Exception;
    }

    private void waitUntil(String what, long timeoutMs, Condition condition) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < end) {
            if (condition.met()) return;
            Thread.sleep(20);
        }
        fail("timed out waiting for " + what);
    }

    // ---- the app and the service ----

    private void openApp() throws Exception {
        scenario = ActivityScenario.launch(MainActivity.class);
        waitUntil("the app to be live", 20_000, SharingState::isAppLive);
    }

    private void bringAppBack() throws Exception {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(launch);
        waitUntil("the app to be live again", 20_000, SharingState::isAppLive);
    }

    private void startSharing() throws Exception {
        SharingState.setSession(new Session("http://127.0.0.1:" + server.port(), "ROOM", "Test Group", "v1.lifecycle.token",
            System.currentTimeMillis() + 3_600_000, 1_000));
        ContextCompat.startForegroundService(context, new Intent(context, LocationShareService.class).setAction(LocationShareService.ACTION_START));
        waitUntil("the first report", 20_000, () -> server.count("POST") >= 1);
    }

    private StatusBarNotification sharingNotification() {
        for (StatusBarNotification n : notifications.getActiveNotifications()) if (n.getId() == SharingNotifications.SHARING_ID) return n;
        return null;
    }

    /** Waits for the app to stop being live and returns the moment it did. */
    private long waitForNotLive() throws Exception {
        long end = SystemClock.elapsedRealtime() + 20_000;
        while (SystemClock.elapsedRealtime() < end) {
            if (!SharingState.isAppLive()) return System.currentTimeMillis();
            Thread.sleep(2);
        }
        fail("the app never stopped being live");
        return 0;
    }

    /**
     * The first report that reached the server after {@code since} and was built from a fix taken after
     * it. Returns the switch-over time in ms, and asserts it is within the limit.
     */
    private long assertFreshReportSoonAfter(String situation, long since) throws Exception {
        final FakeServer.Received[] found = new FakeServer.Received[1];
        waitUntil("a report built from a fix taken after " + situation, 20_000, () -> {
            for (FakeServer.Received r : server.all()) {
                if (r.atMs < since || !r.text.startsWith("POST ")) continue;
                Long took = fedAt.get(seqOf(r.text));
                if (took != null && took >= since) {
                    found[0] = r;
                    return true;
                }
            }
            return false;
        });
        long switchOver = found[0].atMs - since;
        Log.i(TAG, situation + ": switch-over " + switchOver + " ms");
        assertTrue(situation + ": switch-over took " + switchOver + " ms", switchOver <= MAX_SWITCH_OVER_MS);
        return switchOver;
    }

    private int postsBetween(long fromMs, long toMs) {
        int n = 0;
        for (FakeServer.Received r : server.all()) if (r.text.startsWith("POST ") && r.atMs >= fromMs && r.atMs < toMs) n++;
        return n;
    }

    private long largestGapBetweenPosts(long fromMs, long toMs) {
        List<Long> times = new ArrayList<>();
        for (FakeServer.Received r : server.all()) if (r.text.startsWith("POST ") && r.atMs >= fromMs && r.atMs <= toMs) times.add(r.atMs);
        long gap = 0;
        for (int i = 1; i < times.size(); i++) gap = Math.max(gap, times.get(i) - times.get(i - 1));
        return gap;
    }

    // ---- the four situations ----

    @Test
    public void appOnScreen_theServiceIsOnlyAHeartbeat() throws Exception {
        openApp();
        startSharing();
        long start = System.currentTimeMillis();
        Thread.sleep(9_000);
        assertEquals("one report to hold the place, then silence: the app's own socket is the source",
            1, postsBetween(0, Long.MAX_VALUE));
        assertTrue(server.first("POST").contains("\"nextPostWithinSec\":30"));
        assertTrue(SharingState.isAppLive());
        assertTrue(System.currentTimeMillis() - start >= 9_000);
    }

    @Test
    public void homeButton_reportsFreshGpsAtTheFullRateAtOnce() throws Exception {
        openApp();
        startSharing();
        Thread.sleep(2_000);
        assertEquals(1, server.count("POST"));

        shell("input keyevent KEYCODE_HOME");
        long paused = waitForNotLive();
        assertFreshReportSoonAfter("Home button", paused);

        long after = System.currentTimeMillis();
        Thread.sleep(6_000);
        int reports = postsBetween(after, System.currentTimeMillis());
        assertTrue("about one a second at the full rate, not one in thirty: " + reports, reports >= 4);
        assertTrue(server.last("POST").contains("\"nextPostWithinSec\":1"));
        assertTrue(LocationShareService.isRunning());
    }

    @Test
    public void screenOff_appNotSwiped_reportsFreshGpsAtOnce() throws Exception {
        openApp();
        startSharing();
        Thread.sleep(2_000);

        shell("input keyevent KEYCODE_SLEEP");
        long paused = waitForNotLive();
        assertFreshReportSoonAfter("screen off", paused);

        long after = System.currentTimeMillis();
        Thread.sleep(6_000);
        assertTrue("and keeps going with the screen off", postsBetween(after, System.currentTimeMillis()) >= 4);
        shell("input keyevent KEYCODE_WAKEUP");
        shell("wm dismiss-keyguard");
    }

    @Test
    public void swipedAway_whilePausedOrWhileOnScreen_neverStopsTheReports() throws Exception {
        // (a) Home first, then the swipe: no gap in the reports across it.
        openApp();
        startSharing();
        Thread.sleep(2_000);
        shell("input keyevent KEYCODE_HOME");
        long paused = waitForNotLive();
        assertFreshReportSoonAfter("Home before the swipe", paused);
        Thread.sleep(2_000);
        long beforeSwipe = System.currentTimeMillis();
        scenario.onActivity(activity -> activity.finishAndRemoveTask()); // the swipe
        Thread.sleep(8_000);
        long afterSwipe = System.currentTimeMillis();
        assertTrue("reports carried on after the swipe: " + postsBetween(beforeSwipe, afterSwipe), postsBetween(beforeSwipe, afterSwipe) >= 5);
        assertTrue("no gap over 3 s across the swipe: " + largestGapBetweenPosts(beforeSwipe - 2_000, afterSwipe) + " ms",
            largestGapBetweenPosts(beforeSwipe - 2_000, afterSwipe) <= 3_000);
        assertTrue(LocationShareService.isRunning());
        assertNotNull("the notification is still there", sharingNotification());
        scenario = null;

        // (b) The swipe straight from the app on screen: pausing is what starts the fresh reports.
        server.reset();
        fedAt.clear();
        openApp();
        Thread.sleep(2_500); // heartbeat state: the service is running, the app is live
        long swipeStart = System.currentTimeMillis();
        scenario.onActivity(activity -> activity.finishAndRemoveTask());
        long paused2 = waitForNotLive();
        assertTrue(paused2 >= swipeStart);
        assertFreshReportSoonAfter("swipe from the app on screen", paused2);
        assertTrue(LocationShareService.isRunning());
        scenario = null;
    }

    @Test
    public void pausedButNotStopped_splitScreenOrADialogOverTheApp_switchesAllTheSame() throws Exception {
        openApp();
        startSharing();
        Thread.sleep(2_000);
        assertEquals(1, server.count("POST"));

        // What a split-screen neighbour or a dialog over the app does: onPause, no onStop. The real
        // callback is what MainActivity forwards; this calls the same method.
        SharingState.activityPaused();
        long paused = System.currentTimeMillis();
        assertFalse(SharingState.isAppLive());
        assertFreshReportSoonAfter("paused without stopping", paused);

        // And coming back to the foreground drops to the heartbeat again.
        SharingState.activityResumed();
        Thread.sleep(1_000);
        long back = System.currentTimeMillis();
        Thread.sleep(6_000);
        assertEquals("back on screen: no reports beyond the heartbeat", 0, postsBetween(back + 1_500, System.currentTimeMillis()));
        assertTrue(SharingState.isAppLive());
    }
}
