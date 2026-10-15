package com.locus.app.sharing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Locale;
import org.junit.After;
import org.junit.Test;

public class ReportAndEndpointTest {
    private final Locale original = Locale.getDefault();

    @After
    public void restoreLocale() {
        Locale.setDefault(original);
    }

    private static Fix fix(double lat, double lng, double acc, double speed, double heading) {
        return new Fix(lat, lng, acc, speed, heading, 0);
    }

    // ---- the report ----

    @Test
    public void aFullReportIsExactlyWhatTheServerReads() {
        String json = ReportJson.build(fix(12.8222, 80.0436, 9.5, 1.5, 270), "ACTIVE", 30, 55);
        assertEquals("{\"lat\":12.8222,\"lng\":80.0436,\"nextPostWithinSec\":30,\"accuracy\":9.5,\"speed\":5,\"heading\":270,\"battery\":55,\"status\":\"ACTIVE\"}", json);
    }

    @Test
    public void speedGoesOutInKilometresPerHourLikeTheApp() {
        assertTrue(ReportJson.build(fix(1, 2, Double.NaN, 10, Double.NaN), "ACTIVE", 5, -1).contains("\"speed\":36"));
        assertTrue(ReportJson.build(fix(1, 2, Double.NaN, 0, Double.NaN), "ACTIVE", 5, -1).contains("\"speed\":0"));
        assertTrue(ReportJson.build(fix(1, 2, Double.NaN, 1000, Double.NaN), "ACTIVE", 5, -1).contains("\"speed\":400")); // clamped to what the server takes
    }

    @Test
    public void whatThePhoneDidNotSayIsLeftOutNotInvented() {
        String json = ReportJson.build(fix(1, 2, Double.NaN, Double.NaN, Double.NaN), "ACTIVE", 5, -1);
        assertEquals("{\"lat\":1,\"lng\":2,\"nextPostWithinSec\":5,\"status\":\"ACTIVE\"}", json);
        assertFalse(json.contains("accuracy") || json.contains("speed") || json.contains("heading") || json.contains("battery"));
    }

    @Test
    public void pausedIsFrozenAndAnythingElseIsActive() {
        assertTrue(ReportJson.build(fix(1, 2, 3, 0, 0), "FROZEN", 240, 50).endsWith("\"status\":\"FROZEN\"}"));
        assertTrue(ReportJson.build(fix(1, 2, 3, 0, 0), "HACKED", 240, 50).endsWith("\"status\":\"ACTIVE\"}"));
        assertTrue(ReportJson.build(fix(1, 2, 3, 0, 0), null, 240, 50).endsWith("\"status\":\"ACTIVE\"}"));
    }

    @Test
    public void neverSendsAValueTheServerWouldRefuse() {
        String json = ReportJson.build(fix(1, 2, 5_000_000, 1, 725), "ACTIVE", 9_999, 400);
        assertTrue(json.contains("\"nextPostWithinSec\":300"));
        assertTrue(json.contains("\"accuracy\":100000"));
        assertTrue(json.contains("\"heading\":5")); // 725 degrees is 5 degrees
        assertTrue(json.contains("\"battery\":100"));
        assertTrue(ReportJson.build(fix(1, 2, 3, 0, -90), "ACTIVE", 0, 0).contains("\"heading\":270"));
        assertTrue(ReportJson.build(fix(1, 2, 3, 0, 0), "ACTIVE", 0, 0).contains("\"nextPostWithinSec\":1"));
        assertFalse(ReportJson.build(fix(1, 2, -4, 0, 0), "ACTIVE", 5, 0).contains("accuracy"));
    }

    @Test
    public void noUsablePositionMeansNoReportAtAll() {
        assertNull(ReportJson.build(null, "ACTIVE", 5, 50));
        assertNull(ReportJson.build(fix(Double.NaN, 2, 3, 0, 0), "ACTIVE", 5, 50));
        assertNull(ReportJson.build(fix(1, Double.POSITIVE_INFINITY, 3, 0, 0), "ACTIVE", 5, 50));
        assertNull(ReportJson.build(fix(90.0001, 2, 3, 0, 0), "ACTIVE", 5, 50));
        assertNull(ReportJson.build(fix(-91, 2, 3, 0, 0), "ACTIVE", 5, 50));
        assertNull(ReportJson.build(fix(1, 180.5, 3, 0, 0), "ACTIVE", 5, 50));
        assertNull(ReportJson.build(fix(1, -181, 3, 0, 0), "ACTIVE", 5, 50));
        assertEquals("{\"lat\":90,\"lng\":-180", ReportJson.build(fix(90, -180, 3, 0, 0), "ACTIVE", 5, 50).substring(0, 20));
    }

    @Test
    public void numbersAreAlwaysPlainWithADotWhateverThePhoneLanguageIs() {
        Locale.setDefault(Locale.GERMANY);
        String json = ReportJson.build(fix(12.5, -0.00001, 0.5, 0, 0), "ACTIVE", 5, 50);
        assertTrue(json, json.contains("\"lat\":12.5,"));
        assertTrue(json, json.contains("\"lng\":-0.00001,"));
        assertFalse(json, json.matches(".*[0-9][eE][-+]?[0-9].*"));
        Locale.setDefault(new Locale("ar", "EG"));
        assertTrue(ReportJson.build(fix(1.25, 2, 3, 0, 0), "ACTIVE", 5, 50).contains("\"lat\":1.25"));
    }

    @Test
    public void tinyAndHugeNumbersNeverTurnScientific() {
        String json = ReportJson.build(fix(0.0000001, 0.00000001, 1e-9, 0, 0), "ACTIVE", 5, 50);
        assertFalse(json, json.matches(".*[0-9][eE][-+]?[0-9].*")); // never 1.0E-7
        assertTrue(json, json.contains("\"lat\":0.0000001,"));
        assertTrue(json, json.contains("\"lng\":0,")); // below the precision the server needs
    }

    // ---- the address ----

    @Test
    public void onlyHttpsGoesAnywhereOnTheInternet() {
        assertEquals("https://locus-1-896t.onrender.com", Endpoint.validate("https://locus-1-896t.onrender.com"));
        assertEquals("https://locus-1-896t.onrender.com", Endpoint.validate("https://locus-1-896t.onrender.com/"));
        assertEquals("https://example.com:8443", Endpoint.validate("https://example.com:8443"));
        assertNull(Endpoint.validate("http://locus-1-896t.onrender.com"));
        assertNull(Endpoint.validate("http://example.com"));
        assertNull(Endpoint.validate("HTTP://example.com"));
    }

    @Test
    public void plainHttpIsAllowedOnlyForTheDevelopersOwnMachine() {
        assertEquals("http://localhost:5000", Endpoint.validate("http://localhost:5000"));
        assertEquals("http://127.0.0.1:5000", Endpoint.validate("http://127.0.0.1:5000"));
        assertEquals("http://10.0.2.2:5000", Endpoint.validate("http://10.0.2.2:5000/"));
        assertNull(Endpoint.validate("http://192.168.1.5:5000"));
        assertNull(Endpoint.validate("http://localhost.evil.com"));
        assertNull(Endpoint.validate("http://evil.com/localhost"));
    }

    @Test
    public void anythingOddIsRefused() {
        String[] bad = {
            null, "", " ", "  https://example.com", "https://example.com ", "ftp://example.com", "file:///etc/passwd", "javascript:alert(1)",
            "example.com", "//example.com", "https://", "https:///path", "https://user:pw@example.com", "https://user@example.com",
            "https://example.com/api", "https://example.com/?x=1", "https://example.com/#f", "https://exa mple.com", "https://example.com\n",
        };
        for (String b : bad) assertNull(String.valueOf(b), Endpoint.validate(b));
        StringBuilder long301 = new StringBuilder("https://");
        for (int i = 0; i < 300; i++) long301.append('a');
        assertNull(Endpoint.validate(long301 + ".com"));
    }
}
