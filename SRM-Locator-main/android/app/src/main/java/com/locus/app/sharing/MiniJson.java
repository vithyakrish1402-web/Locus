package com.locus.app.sharing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A strict JSON reader for the one answer the service has to understand: the list of SOS. Written
 * by hand, like ReportJson, so it behaves the same on every phone and in the plain-Java unit tests
 * (Android's own JSON classes are not there in those), with no dependency.
 *
 * Gives Map (object), List (array), String, Double (every number), Boolean, or null. Anything that
 * is not exactly one JSON value, or is nested more than {@link #MAX_DEPTH} deep, or longer than
 * {@link #MAX_LENGTH}, throws IllegalArgumentException: a cut-off or garbled answer is never half
 * believed.
 */
final class MiniJson {
    static final int MAX_DEPTH = 8;
    static final int MAX_LENGTH = 64 * 1024;

    private final String s;
    private int i = 0;

    private MiniJson(String s) {
        this.s = s;
    }

    static Object parse(String text) {
        if (text == null || text.length() > MAX_LENGTH) throw new IllegalArgumentException("size");
        MiniJson p = new MiniJson(text);
        p.skip();
        Object value = p.value(0);
        p.skip();
        if (p.i != text.length()) throw new IllegalArgumentException("trailing");
        return value;
    }

    private void skip() {
        while (i < s.length() && (s.charAt(i) == ' ' || s.charAt(i) == '\n' || s.charAt(i) == '\r' || s.charAt(i) == '\t')) i++;
    }

    private char peek() {
        if (i >= s.length()) throw new IllegalArgumentException("end");
        return s.charAt(i);
    }

    private void expect(char c) {
        if (peek() != c) throw new IllegalArgumentException("expected " + c);
        i++;
    }

    private Object value(int depth) {
        if (depth > MAX_DEPTH) throw new IllegalArgumentException("deep");
        char c = peek();
        if (c == '{') return object(depth);
        if (c == '[') return array(depth);
        if (c == '"') return string();
        if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i)) { i += 4; return null; }
        return number();
    }

    private Map<String, Object> object(int depth) {
        expect('{');
        Map<String, Object> map = new LinkedHashMap<>();
        skip();
        if (peek() == '}') { i++; return map; }
        for (;;) {
            skip();
            String key = string();
            skip();
            expect(':');
            skip();
            map.put(key, value(depth + 1));
            skip();
            char c = peek();
            i++;
            if (c == '}') return map;
            if (c != ',') throw new IllegalArgumentException("object");
        }
    }

    private List<Object> array(int depth) {
        expect('[');
        List<Object> list = new ArrayList<>();
        skip();
        if (peek() == ']') { i++; return list; }
        for (;;) {
            skip();
            list.add(value(depth + 1));
            skip();
            char c = peek();
            i++;
            if (c == ']') return list;
            if (c != ',') throw new IllegalArgumentException("array");
        }
    }

    private String string() {
        expect('"');
        StringBuilder b = new StringBuilder();
        for (;;) {
            char c = peek();
            i++;
            if (c == '"') return b.toString();
            if (c < 0x20) throw new IllegalArgumentException("control");
            if (c != '\\') { b.append(c); continue; }
            char e = peek();
            i++;
            switch (e) {
                case '"': b.append('"'); break;
                case '\\': b.append('\\'); break;
                case '/': b.append('/'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'n': b.append('\n'); break;
                case 'r': b.append('\r'); break;
                case 't': b.append('\t'); break;
                case 'u':
                    if (i + 4 > s.length()) throw new IllegalArgumentException("unicode");
                    try {
                        b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    } catch (NumberFormatException ex) {
                        throw new IllegalArgumentException("unicode");
                    }
                    i += 4;
                    break;
                default:
                    throw new IllegalArgumentException("escape");
            }
        }
    }

    private Double number() {
        int start = i;
        if (i < s.length() && s.charAt(i) == '-') i++;
        int digits = 0;
        while (i < s.length() && Character.isDigit(s.charAt(i))) { i++; digits++; }
        if (digits == 0) throw new IllegalArgumentException("number");
        if (i < s.length() && s.charAt(i) == '.') {
            i++;
            int fraction = 0;
            while (i < s.length() && Character.isDigit(s.charAt(i))) { i++; fraction++; }
            if (fraction == 0) throw new IllegalArgumentException("number");
        }
        if (i < s.length() && (s.charAt(i) == 'e' || s.charAt(i) == 'E')) {
            i++;
            if (i < s.length() && (s.charAt(i) == '+' || s.charAt(i) == '-')) i++;
            int exponent = 0;
            while (i < s.length() && Character.isDigit(s.charAt(i))) { i++; exponent++; }
            if (exponent == 0) throw new IllegalArgumentException("number");
        }
        try {
            double d = Double.parseDouble(s.substring(start, i));
            if (Double.isNaN(d) || Double.isInfinite(d)) throw new IllegalArgumentException("number");
            return d;
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("number");
        }
    }
}
