package com.locus.app.sharing;
import org.junit.Test;
import static org.junit.Assert.*;
public class PingNoticeTest {
    @Test public void parsesOnlyValidPings() {
        java.util.List<PingNotice> p = PingNotice.parse("{\"pings\":[{\"rev\":2,\"senderName\":\"Alice\"},{\"rev\":-1,\"senderName\":\"bad\"}]}");
        assertEquals(1, p.size()); assertEquals(2, p.get(0).rev); assertEquals("Alice", p.get(0).senderName);
        assertTrue(PingNotice.parse("{}").isEmpty());
        assertTrue(PingNotice.parse("invalid").isEmpty());
    }
}
