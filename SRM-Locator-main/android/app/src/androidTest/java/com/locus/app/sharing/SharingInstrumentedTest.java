package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
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

import androidx.core.content.ContextCompat;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The Android-only parts of background sharing, on a real (emulated) Android: the Keystore, the
 * foreground service and its notification, location updates (mocked fixes), pause/resume/stop,
 * the server telling it the pass is finished, refusing to start without notifications, and the
 * "Tap to resume" notice. A fake server on the device records exactly what the service sends.
 *
 * It is not the real thing: an emulator has no Doze, no phone-maker task killer and no real
 * battery. BACKGROUND_SHARING_PHONE_TEST.md covers what only a phone can show.
 */
@RunWith(AndroidJUnit4.class)
public class SharingInstrumentedTest {
    private final Context context = ApplicationProvider.getApplicationContext();
    private final UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
    private final LocationManager locations = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
    private final NotificationManager notifications = context.getSystemService(NotificationManager.class);

    /**
     * Revoking the notification permission kills the process this test runs in, so the one test
     * that needs notifications OFF is run on its own, after the host has revoked it:
     *   adb -s emulator-5554 shell pm revoke com.locus.app android.permission.POST_NOTIFICATIONS
     *   adb -s emulator-5554 shell am instrument -w -e notifications off -e class ...#withoutNotificationsSharingDoesNotStartAndSaysWhy ...
     */
    private final boolean notificationsOff = "off".equals(InstrumentationRegistry.getArguments().getString("notifications"));

    private FakeServer server;
    private final List<String[]> states = Collections.synchronizedList(new ArrayList<>());

    // ---- set-up and tear-down ----

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
        if (!notificationsOff) {
            automation.grantRuntimePermission(pkg, "android.permission.POST_NOTIFICATIONS");
            shell("appops set " + pkg + " POST_NOTIFICATION allow");
        }
        shell("appops set " + pkg + " android:mock_location allow");
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
        SharingState.setListener((state, reason) -> states.add(new String[] {state, reason}));
        notifications.cancelAll();
    }

    @After
    public void tearDown() throws Exception {
        try {
            context.startService(new Intent(context, LocationShareService.class).setAction(LocationShareService.ACTION_STOP));
        } catch (Exception ignored) {
            // not running
        }
        waitFor("service to end", 10_000, () -> !LocationShareService.isRunning());
        SharingState.setListener(null);
        SharingState.forget(context);
        server.stop();
        try {
            locations.removeTestProvider(LocationManager.GPS_PROVIDER);
        } catch (Exception ignored) {
            // already gone
        }
    }

    // ---- helpers ----

    private interface Condition {
        boolean met() throws Exception;
    }

    /** Polls, and keeps feeding mocked fixes, until the condition holds. */
    private void waitFor(String what, long timeoutMs, Condition condition) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < end) {
            feedFix(12.9, 80.1);
            if (condition.met()) return;
            Thread.sleep(250);
        }
        fail("timed out waiting for " + what);
    }

    private void feedFix(double lat, double lng) {
        try {
            Location l = new Location(LocationManager.GPS_PROVIDER);
            l.setLatitude(lat);
            l.setLongitude(lng);
            l.setAccuracy(5f);
            l.setSpeed(1.5f);
            l.setBearing(270f);
            l.setTime(System.currentTimeMillis());
            l.setElapsedRealtimeNanos(SystemClock.elapsedRealtimeNanos());
            locations.setTestProviderLocation(LocationManager.GPS_PROVIDER, l);
        } catch (Exception ignored) {
            // provider not ready yet
        }
    }

    private Session sessionFor(long expiresInMs, String token) {
        return new Session("http://127.0.0.1:" + server.port(), "ROOM", "Test Group", token, System.currentTimeMillis() + expiresInMs, 1_000);
    }

    private void startSharing(Session session) {
        SharingState.setSession(session);
        ContextCompat.startForegroundService(context, new Intent(context, LocationShareService.class).setAction(LocationShareService.ACTION_START));
    }

    private void send(String action, int minutes) {
        context.startService(new Intent(context, LocationShareService.class).setAction(action).putExtra(LocationShareService.EXTRA_MINUTES, minutes));
    }

    private StatusBarNotification active(int id) {
        for (StatusBarNotification n : notifications.getActiveNotifications()) if (n.getId() == id) return n;
        return null;
    }

    private String lastState() {
        synchronized (states) {
            return states.isEmpty() ? null : states.get(states.size() - 1)[0] + ":" + states.get(states.size() - 1)[1];
        }
    }

    // ---- the Keystore and the token store, for real ----

    @Test
    public void theKeystoreSealsAndOpensAndRefusesTamperedBytes() throws Exception {
        KeystoreSecretBox box = new KeystoreSecretBox();
        byte[] plain = "v1.TOKEN.MARK".getBytes(StandardCharsets.UTF_8);
        byte[] sealed = box.seal(plain);
        assertFalse(new String(sealed, StandardCharsets.ISO_8859_1).contains("TOKEN"));
        assertEquals("v1.TOKEN.MARK", new String(box.open(sealed), StandardCharsets.UTF_8));
        byte[] again = box.seal(plain);
        assertFalse("a fresh IV every time", java.util.Arrays.equals(sealed, again));
        sealed[sealed.length - 1] ^= 1;
        try {
            box.open(sealed);
            fail("tampered bytes were accepted");
        } catch (Exception expected) {
            // good
        }
    }

    @Test
    public void aSessionSurvivesInTheRealStoreAndNeverTouchesDiskInTheClear() throws Exception {
        TokenStore store = SharingState.store(context);
        Session s = sessionFor(3_600_000, "v1.REALSTORE.MARK");
        assertTrue(store.save(s));
        assertEquals("v1.REALSTORE.MARK", SharingState.store(context).load().deviceToken);
        assertEquals("Test Group", store.resumeHint(System.currentTimeMillis()));
        File dir = new File(context.getNoBackupFilesDir(), "locus_sharing");
        File[] files = dir.listFiles();
        assertNotNull(files);
        assertTrue(files.length >= 2);
        for (File f : files) {
            byte[] bytes = java.nio.file.Files.readAllBytes(f.toPath());
            assertFalse(f.getName(), new String(bytes, StandardCharsets.ISO_8859_1).contains("REALSTORE"));
        }
        store.clear();
        assertNull(store.load());
    }

    // ---- the service ----

    @Test
    public void theServiceReportsPausesResumesAndStops() throws Exception {
        startSharing(sessionFor(3_600_000, "v1.service.token"));

        waitFor("the first report", 20_000, () -> server.count("POST") >= 1);
        String first = server.first("POST");
        assertTrue(first, first.contains("auth=Bearer v1.service.token"));
        assertTrue(first, first.contains("POST /api/background/location"));
        assertTrue(first, first.contains("\"lat\":12.9") && first.contains("\"lng\":80.1"));
        assertTrue(first, first.contains("\"accuracy\":5") && first.contains("\"status\":\"ACTIVE\"") && first.contains("\"heading\":270"));
        assertTrue(first, first.contains("\"speed\":5"));
        assertTrue(first, first.contains("\"nextPostWithinSec\":1"));
        assertTrue(LocationShareService.isRunning());
        assertEquals("running:null", lastState());

        // The permanent notification says who it is shared with, and has its three buttons.
        StatusBarNotification n = active(SharingNotifications.SHARING_ID);
        assertNotNull("the sharing notification is showing", n);
        assertEquals(SharingNotifications.CHANNEL_SHARING, n.getNotification().getChannelId());
        assertTrue(n.getNotification().extras.getCharSequence("android.text").toString().contains("Test Group"));
        assertEquals(3, n.getNotification().actions.length);
        assertEquals("Pause 15 min", n.getNotification().actions[0].title.toString());
        assertEquals("Stop", n.getNotification().actions[2].title.toString());

        // Pause: a FROZEN report goes out at once, and the notification changes.
        int before = server.count("POST");
        send(LocationShareService.ACTION_PAUSE, 15);
        waitFor("a paused report", 10_000, () -> server.countContaining("\"status\":\"FROZEN\"") >= 1);
        assertTrue(server.last("POST"), server.last("POST").contains("\"nextPostWithinSec\":240"));
        assertEquals("paused:null", lastState());
        waitFor("paused notification", 5_000, () -> active(SharingNotifications.SHARING_ID) != null
            && active(SharingNotifications.SHARING_ID).getNotification().extras.getCharSequence("android.title").toString().contains("paused"));
        assertEquals("Resume", active(SharingNotifications.SHARING_ID).getNotification().actions[0].title.toString());
        int whilePaused = server.count("POST");
        Thread.sleep(3_000);
        assertTrue("paused: no new live reports", server.count("POST") - whilePaused <= 1);
        assertTrue(before > 0);

        // Resume: live reports again.
        send(LocationShareService.ACTION_RESUME, 0);
        int resumed = server.countContaining("\"status\":\"ACTIVE\"");
        waitFor("reports after resuming", 15_000, () -> server.countContaining("\"status\":\"ACTIVE\"") > resumed);
        assertEquals("running:null", lastState());

        // Stop: the server is told, the notification and the token go.
        send(LocationShareService.ACTION_STOP, 0);
        waitFor("the service to stop", 15_000, () -> !LocationShareService.isRunning());
        waitFor("the stop to reach the server", 10_000, () -> server.count("DELETE") >= 1);
        assertTrue(server.first("DELETE"), server.first("DELETE").contains("DELETE /api/background/session auth=Bearer v1.service.token"));
        assertEquals("stopped:user-stop", lastState());
        assertNull("the notification is gone", active(SharingNotifications.SHARING_ID));
        assertNull("the token is forgotten", SharingState.session());
        assertNull("and not left on disk", SharingState.store(context).load());
        assertNull(SharingState.store(context).resumeHint(System.currentTimeMillis()));
    }

    @Test
    public void aServerThatSaysTheLeaseIsFinishedStopsTheServiceAndTellsTheAppWhy() throws Exception {
        server.status = 401;
        server.body = "{\"error\":\"invalid-token\",\"reason\":\"revoked\"}";
        startSharing(sessionFor(3_600_000, "v1.revoked.token"));
        waitFor("the service to stop itself", 25_000, () -> server.count("POST") >= 1 && !LocationShareService.isRunning());
        assertEquals("stopped:revoked", lastState());
        assertEquals("no stop request after being told", 0, server.count("DELETE"));
        assertNull(active(SharingNotifications.SHARING_ID));
        assertNull(SharingState.session());
        assertNull(SharingState.store(context).load());
    }

    @Test
    public void aGroupThatIsGoneAndAMemberThatWasRemovedEachStopIt() throws Exception {
        for (int[] statusAndReason : new int[][] {{410, 0}, {403, 1}}) {
            server.reset();
            server.status = statusAndReason[0];
            server.body = statusAndReason[0] == 410 ? "{\"error\":\"no-group\"}" : "{\"error\":\"blocked\"}";
            states.clear();
            startSharing(sessionFor(3_600_000, "v1.gone.token"));
            waitFor("the service to stop", 25_000, () -> server.count("POST") >= 1 && !LocationShareService.isRunning());
            assertEquals(statusAndReason[0] == 410 ? "stopped:group-gone" : "stopped:forbidden", lastState());
        }
    }

    @Test
    public void aServerThatIsDownIsRetriedNotGivenUpOn() throws Exception {
        server.status = 503;
        server.body = "";
        startSharing(sessionFor(3_600_000, "v1.down.token"));
        waitFor("the first attempt", 20_000, () -> server.count("POST") >= 1);
        Thread.sleep(1_500);
        assertTrue("still sharing while the server is down", LocationShareService.isRunning());
        server.status = 200;
        server.body = "{\"ok\":true}";
        waitFor("it to get through once the server is back", 30_000, () -> server.countWithStatus(200) >= 1);
        assertTrue(LocationShareService.isRunning());
    }

    @Test
    public void aPassThatHasRunOutEndsSharing() throws Exception {
        startSharing(sessionFor(7_000, "v1.shortlived.token"));
        waitFor("the first report", 20_000, () -> server.count("POST") >= 1);
        waitFor("the pass to run out", 25_000, () -> !LocationShareService.isRunning());
        assertEquals("stopped:token-expired", lastState());
        assertNull(SharingState.session());
    }

    @Test
    public void withoutNotificationsSharingDoesNotStartAndSaysWhy() throws Exception {
        Assume.assumeTrue("needs the host to revoke the notification permission first (see notificationsOff)", notificationsOff);
        assertFalse("setup: notifications are off", SharingNotifications.canBeSeen(context));
        startSharing(sessionFor(3_600_000, "v1.nonotify.token"));
        waitFor("the refusal", 15_000, () -> !LocationShareService.isRunning() && "stopped:notifications-denied".equals(lastState()));
        Thread.sleep(1_500);
        assertEquals("nothing was ever sent", 0, server.count("POST"));
        assertNull(SharingState.session());
    }

    // ---- the notice after a restart ----

    @Test
    public void bootPostsOnlyTheResumeNoticeAndOnlyWhenThereIsSomethingToResume() throws Exception {
        BootResumeReceiver receiver = new BootResumeReceiver();

        receiver.onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));
        assertNull("nothing to resume, nothing said", active(SharingNotifications.RESUME_ID));

        SharingState.store(context).save(sessionFor(3_600_000, "v1.boot.token"));
        receiver.onReceive(context, new Intent("android.intent.action.SOMETHING_ELSE"));
        assertNull("only the boot broadcast counts", active(SharingNotifications.RESUME_ID));

        receiver.onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));
        StatusBarNotification notice = active(SharingNotifications.RESUME_ID);
        assertNotNull(notice);
        assertEquals(SharingNotifications.CHANNEL_RESUME, notice.getNotification().getChannelId());
        assertTrue(notice.getNotification().extras.getCharSequence("android.text").toString().contains("Tap to resume sharing with Test Group"));
        assertFalse("and it did not start the service", LocationShareService.isRunning());
        assertEquals(0, server.count("POST"));
        SharingState.store(context).clear();
    }
}
