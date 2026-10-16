package com.locus.app.sharing;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class TokenStoreTest {
    private static final String TOKEN = "v1.SECRETPAYLOADMARK.SECRETSIGNATUREMARK";
    private static final Session SESSION = new Session("https://locus-1-896t.onrender.com", "ROOM42", "Study Group", TOKEN, 1_900_000_000_000L, 5_000);

    /** Reversible, and visibly not the original: a stand-in for the Keystore. */
    private static final class FakeBox implements TokenStore.SecretBox {
        boolean broken = false;
        boolean returnsEmpty = false;

        @Override
        public byte[] seal(byte[] plain) throws Exception {
            if (broken) throw new IllegalStateException("keystore unavailable");
            if (returnsEmpty) return new byte[0];
            byte[] out = new byte[plain.length + 1];
            out[0] = 42;
            for (int i = 0; i < plain.length; i++) out[i + 1] = (byte) (plain[i] ^ 0x5A);
            return out;
        }

        @Override
        public byte[] open(byte[] sealed) throws Exception {
            if (broken) throw new IllegalStateException("keystore unavailable");
            if (sealed.length < 1 || sealed[0] != 42) throw new IllegalArgumentException("not sealed by us");
            byte[] out = new byte[sealed.length - 1];
            for (int i = 0; i < out.length; i++) out[i] = (byte) (sealed[i + 1] ^ 0x5A);
            return out;
        }
    }

    private static final class MemoryKeyValue implements TokenStore.KeyValue {
        final Map<String, byte[]> data = new HashMap<>();
        final List<String> writes = new ArrayList<>();

        public byte[] get(String key) { return data.get(key); }

        public void put(String key, byte[] value) { data.put(key, value); writes.add(key); }

        public void remove(String key) { data.remove(key); }
    }

    private static boolean contains(byte[] haystack, String needle) {
        return new String(haystack, StandardCharsets.ISO_8859_1).contains(needle);
    }

    private FakeBox box;
    private MemoryKeyValue files;
    private TokenStore store;

    @Before
    public void setUp() {
        box = new FakeBox();
        files = new MemoryKeyValue();
        store = new TokenStore(box, files);
    }

    @Test
    public void aSavedSessionComesBackExactly() {
        assertTrue(store.save(SESSION));
        Session back = store.load();
        assertNotNull(back);
        assertEquals(SESSION.baseUrl, back.baseUrl);
        assertEquals(SESSION.roomCode, back.roomCode);
        assertEquals(SESSION.groupName, back.groupName);
        assertEquals(SESSION.deviceToken, back.deviceToken);
        assertEquals(SESSION.expiresAtMs, back.expiresAtMs);
        assertEquals(SESSION.pollingMs, back.pollingMs);
    }

    @Test
    public void theTokenIsNeverWrittenInTheClear() {
        store.save(SESSION);
        for (byte[] stored : files.data.values()) {
            assertFalse(contains(stored, "SECRETPAYLOADMARK"));
            assertFalse(contains(stored, TOKEN));
            assertFalse(contains(stored, "onrender"));
        }
    }

    @Test
    public void ifSealingFailsNothingIsStoredAtAll() {
        box.broken = true;
        assertFalse(store.save(SESSION));
        assertTrue(files.data.isEmpty());
        assertTrue(files.writes.isEmpty());
        assertNull(store.load());
        assertNull(store.resumeHint(0));
    }

    @Test
    public void ifSealingGivesNothingBackNothingIsStoredEither() {
        box.returnsEmpty = true;
        assertFalse(store.save(SESSION));
        assertTrue(files.data.isEmpty());
    }

    @Test
    public void aFailedSaveDoesNotLeaveAnOlderSessionBehind() {
        assertTrue(store.save(SESSION));
        box.broken = true;
        assertFalse(store.save(SESSION.withToken("v1.NEW.NEW", 1_900_000_000_001L)));
        box.broken = false;
        assertNull(store.load()); // not the stale one
    }

    @Test
    public void aStoreThatThrowsOnWritingIsAFailureNotACrash() {
        TokenStore broken = new TokenStore(box, new TokenStore.KeyValue() {
            public byte[] get(String key) { return null; }

            public void put(String key, byte[] value) { throw new IllegalStateException("disk full"); }

            public void remove(String key) { }
        });
        assertFalse(broken.save(SESSION));
    }

    @Test
    public void somethingUnreadableIsClearedAndTreatedAsNothing() {
        store.save(SESSION);
        files.data.put(TokenStore.SESSION_KEY, new byte[] {1, 2, 3, 4});
        assertNull(store.load());
        assertTrue(files.data.isEmpty());
    }

    @Test
    public void aKeystoreThatLostItsKeyIsClearedToo() {
        store.save(SESSION);
        box.broken = true;
        assertNull(store.load());
        assertTrue(files.data.isEmpty());
    }

    @Test
    public void tamperedBytesAreNotAccepted() {
        store.save(SESSION);
        byte[] sealed = files.data.get(TokenStore.SESSION_KEY).clone();
        sealed[sealed.length - 1] ^= 1; // flips a byte of the last field, still a "valid" shape
        files.data.put(TokenStore.SESSION_KEY, new byte[] {42, 0, 0, 0, 7});
        assertNull(store.load());
    }

    @Test
    public void clearingRemovesEverythingIncludingTheHint() {
        store.save(SESSION);
        assertEquals("Study Group", store.resumeHint(0));
        store.clear();
        assertNull(store.load());
        assertNull(store.resumeHint(0));
        assertTrue(files.data.isEmpty());
    }

    @Test
    public void theResumeHintHoldsTheGroupNameAndNothingSecret() {
        store.save(SESSION);
        byte[] hint = files.data.get(TokenStore.HINT_KEY);
        assertArrayEquals("1900000000000\nStudy Group".getBytes(StandardCharsets.UTF_8), hint);
        assertFalse(contains(hint, "SECRET"));
    }

    @Test
    public void theResumeHintStopsBeingOfferedOnceThePassHasRunOut() {
        store.save(SESSION);
        assertEquals("Study Group", store.resumeHint(1_899_999_999_999L));
        assertNull(store.resumeHint(1_900_000_000_000L));
        assertNull(store.resumeHint(Long.MAX_VALUE));
    }

    @Test
    public void aDamagedHintIsNothingToResume() {
        for (String bad : new String[] {"", "Study Group", "abc\nStudy Group", "\nStudy Group", "12"}) {
            files.data.put(TokenStore.HINT_KEY, bad.getBytes(StandardCharsets.UTF_8));
            assertNull(bad, store.resumeHint(0));
        }
        files.data.remove(TokenStore.HINT_KEY);
        assertNull(store.resumeHint(0));
    }

    @Test
    public void aSessionNeverPrintsItsToken() {
        assertFalse(SESSION.toString().contains("SECRET"));
        assertFalse(SESSION.toString().contains("ROOM42"));
    }

    @Test
    public void aSessionSurvivesStrangeText() {
        Session odd = new Session("http://10.0.2.2:5000", "Ré中", "Grüppe 😀 \"quoted\"", "v1.a.b", 5, 1_000);
        assertTrue(store.save(odd));
        assertEquals("Grüppe 😀 \"quoted\"", store.load().groupName);
        assertEquals("Ré中", store.load().roomCode);
    }

    @Test
    public void bytesThatAreNotASessionAreRefused() {
        assertNull(Session.fromBytes(new byte[0]));
        assertNull(Session.fromBytes(new byte[] {0, 0, 0, 2}));
        assertNull(Session.fromBytes(new byte[] {0, 0, 0, 1, 127, 127, 127, 127}));
        byte[] good = SESSION.toBytes();
        byte[] extra = new byte[good.length + 1];
        System.arraycopy(good, 0, extra, 0, good.length);
        assertNull(Session.fromBytes(extra));
        assertNull(Session.fromBytes(java.util.Arrays.copyOf(good, good.length - 3)));
    }

    @Test
    public void renewingKeepsEverythingButTheTokenAndExpiry() {
        Session renewed = SESSION.withToken("v1.new.new", 2_000_000_000_000L);
        assertEquals("v1.new.new", renewed.deviceToken);
        assertEquals(2_000_000_000_000L, renewed.expiresAtMs);
        assertEquals(SESSION.roomCode, renewed.roomCode);
        assertEquals(SESSION.groupName, renewed.groupName);
        assertEquals(SESSION.baseUrl, renewed.baseUrl);
        assertEquals(10_000, SESSION.withPolling(10_000).pollingMs);
    }

    // ---- the files it is kept in ----

    private File dir;

    @Before
    public void makeDir() throws IOException {
        dir = Files.createTempDirectory("locus-kv").toFile();
    }

    @After
    public void removeDir() {
        File[] left = dir.listFiles();
        if (left != null) for (File f : left) f.delete();
        dir.delete();
    }

    @Test
    public void filesStoreAndReturnBytesAndReplaceThem() {
        FileKeyValue kv = new FileKeyValue(new File(dir, "nested"));
        assertNull(kv.get("a"));
        kv.put("a", new byte[] {1, 2, 3});
        assertArrayEquals(new byte[] {1, 2, 3}, kv.get("a"));
        kv.put("a", new byte[] {9});
        assertArrayEquals(new byte[] {9}, kv.get("a"));
        kv.remove("a");
        assertNull(kv.get("a"));
        kv.remove("a"); // already gone: no fuss
    }

    @Test
    public void filesNeverLeaveTheirFolderAndLeaveNoTemporaryBehind() {
        FileKeyValue kv = new FileKeyValue(dir);
        for (String bad : new String[] {"../x", "a/b", "a\\b", "", "..", ".", ".hidden", "a b"}) {
            try {
                kv.put(bad, new byte[] {1});
                fail("accepted " + bad);
            } catch (IllegalArgumentException expected) {
                // good
            }
        }
        kv.put("ok", new byte[] {1});
        String[] names = dir.list();
        assertEquals(1, names.length);
        assertEquals("ok", names[0]);
    }

    @Test
    public void aWholeStoreWorksOnRealFiles() {
        TokenStore onDisk = new TokenStore(new FakeBox(), new FileKeyValue(dir));
        assertTrue(onDisk.save(SESSION));
        assertEquals(TOKEN, new TokenStore(new FakeBox(), new FileKeyValue(dir)).load().deviceToken); // a new process reads it
        onDisk.clear();
        assertNull(onDisk.load());
        assertEquals(0, dir.list().length);
    }
}
