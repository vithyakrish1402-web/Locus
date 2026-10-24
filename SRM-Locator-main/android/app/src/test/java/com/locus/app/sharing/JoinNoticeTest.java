package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** The server's "people waiting to join" field, and the words of its notification. */
public class JoinNoticeTest {

    @Test
    public void readsTheJoinField() {
        JoinNotice n = JoinNotice.parse("{\"sos\":[],\"rev\":4,\"join\":{\"rev\":2,\"count\":3}}");
        assertEquals(2, n.rev);
        assertEquals(3, n.count);
    }

    @Test
    public void ignoresAnAnswerWithoutOneOrAGarbledOne() {
        assertNull(JoinNotice.parse("{\"sos\":[],\"rev\":4}"));
        assertNull(JoinNotice.parse("{\"join\":{\"rev\":0,\"count\":3}}"));
        assertNull(JoinNotice.parse("{\"join\":{\"rev\":1,\"count\":-1}}"));
        assertNull(JoinNotice.parse("{\"join\":{\"rev\":\"1\",\"count\":3}}"));
        assertNull(JoinNotice.parse("{\"join\":[1,2]}"));
        assertNull(JoinNotice.parse("not json"));
        assertNull(JoinNotice.parse(""));
    }

    @Test
    public void capsAnAbsurdCount() {
        assertEquals(JoinNotice.MAX_COUNT, JoinNotice.parse("{\"join\":{\"rev\":1,\"count\":100000}}").count);
    }

    @Test
    public void theNotificationSaysHowManyInPlainWords() {
        assertEquals("1 person waiting to join", JoinNotifications.title(1));
        assertEquals("3 people waiting to join", JoinNotifications.title(3));
        assertEquals("Tap to let them in to Hostel crew", JoinNotifications.text("Hostel crew"));
        assertEquals("Tap to let them in", JoinNotifications.text(null));
    }
}
