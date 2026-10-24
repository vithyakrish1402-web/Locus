package com.locus.app.sharing;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class PingNotice {
    public final long rev;
    public final String senderName;
    PingNotice(long rev, String name) { this.rev = rev; this.senderName = name; }
    public static List<PingNotice> parse(String body) {
        List<PingNotice> result = new ArrayList<>();
        try {
            Object root = MiniJson.parse(body);
            if (!(root instanceof Map)) return result;
            Object items = ((Map<?, ?>) root).get("pings");
            if (!(items instanceof List)) return result;
            for (Object value : (List<?>) items) {
                if (!(value instanceof Map)) continue;
                Map<?, ?> item = (Map<?, ?>) value;
                Object rev = item.get("rev"), name = item.get("senderName");
                if (!(rev instanceof Double) || !(name instanceof String)) continue;
                double number = (Double) rev;
                if (!Double.isFinite(number) || number < 1 || number >= 9e15) continue;
                String text = (String) name;
                result.add(new PingNotice((long) number, text.substring(0, Math.min(80, text.length()))));
            }
        } catch (IllegalArgumentException ignored) {}
        return result;
    }
}
