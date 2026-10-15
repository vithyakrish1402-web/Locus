package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

/** The reason sharing last stopped by itself, kept for the app's next launch. */
public class StopNoteTest {
    private static final class Memory implements TokenStore.KeyValue {
        final Map<String, byte[]> data = new HashMap<>();

        public byte[] get(String key) { return data.get(key); }
        public void put(String key, byte[] value) { data.put(key, value); }
        public void remove(String key) { data.remove(key); }
    }

    @Test
    public void keepsAnEndingThePersonDidNotAskFor() {
        StopNote note = new StopNote(new Memory());
        note.record("group-gone");
        assertEquals("group-gone", note.read());
    }

    @Test
    public void survivesANewObjectOverTheSameStorage() {
        Memory disk = new Memory();
        new StopNote(disk).record("revoked");
        assertEquals("revoked", new StopNote(disk).read()); // what a restarted process sees
    }

    @Test
    public void aStopThePersonAskedForClearsIt() {
        StopNote note = new StopNote(new Memory());
        note.record("group-gone");
        note.record("user-stop");
        assertNull(note.read());
    }

    @Test
    public void acknowledgingClearsIt() {
        StopNote note = new StopNote(new Memory());
        note.record("server-unreachable");
        note.clear();
        assertNull(note.read());
    }

    @Test
    public void nothingRecordedReadsAsNothing() {
        assertNull(new StopNote(new Memory()).read());
    }

    @Test
    public void refusesAnythingThatIsNotAReasonWord() {
        Memory disk = new Memory();
        StopNote note = new StopNote(disk);
        note.record("group-gone");
        note.record("Bad Reason!");
        assertNull(note.read());
        disk.put(StopNote.KEY, "{\"token\":\"x\"}".getBytes());
        assertNull(note.read());
        disk.put(StopNote.KEY, new byte[500]);
        assertNull(note.read());
        byte[] longWord = new byte[41];
        java.util.Arrays.fill(longWord, (byte) 'a');
        disk.put(StopNote.KEY, longWord); // all valid characters, but not one of our reason words
        assertNull(note.read());
        note.record(null);
        note.record("");
        assertNull(note.read());
    }

    @Test
    public void aLaterEndingReplacesAnEarlierOne() {
        StopNote note = new StopNote(new Memory());
        note.record("server-unreachable");
        note.record("group-gone");
        assertEquals("group-gone", note.read());
    }
}
