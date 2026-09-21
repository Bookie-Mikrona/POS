package com.bookievivabridge;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** The protocol hashes the JSON member (without its enclosing root braces). */
public final class PaytenFraming {
  private PaytenFraming() {}
  public static String member(String name, String value) { return "\"" + name + "\":" + value; }
  public static int length(String member) { return member.getBytes(StandardCharsets.UTF_8).length; }
  public static String sha512(String member) throws Exception {
    byte[] digest = MessageDigest.getInstance("SHA-512").digest(member.getBytes(StandardCharsets.UTF_8));
    StringBuilder out = new StringBuilder(128);
    for (byte b : digest) out.append(String.format("%02x", b & 0xff));
    return out.toString();
  }
  public static String sha256(byte[] bytes) throws Exception {
    byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
    StringBuilder out = new StringBuilder(64);
    for (byte b : digest) out.append(String.format("%02x", b & 0xff));
    return out.toString();
  }
  public static boolean validCallbackAction(String action) {
    return action != null && action.matches("com\\.bookievivabridge\\.payten\\.result\\.[A-Za-z0-9_-]{43}");
  }

  /** Returns an exact root member (for example, `"response": { ... }`).
   * Unlike JSONObject this intentionally preserves whitespace, ordering and escapes. */
  public static String rootMember(String json, String wanted) {
    int n = json.length(), i = ws(json, 0);
    if (i >= n || json.charAt(i++) != '{') throw new IllegalArgumentException("root is not object");
    while (true) {
      i = ws(json, i);
      if (i >= n || json.charAt(i) == '}') break;
      int keyStart = i, keyEnd = stringEnd(json, i);
      String key = unquote(json.substring(keyStart, keyEnd));
      i = ws(json, keyEnd);
      if (i >= n || json.charAt(i++) != ':') throw new IllegalArgumentException("bad member");
      int valueStart = ws(json, i), valueEnd = valueEnd(json, valueStart);
      if (wanted.equals(key)) return json.substring(keyStart, valueEnd);
      i = ws(json, valueEnd);
      if (i >= n || json.charAt(i) != ',') break;
      i++;
    }
    throw new IllegalArgumentException("member missing");
  }
  private static int ws(String s, int i) { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; return i; }
  private static int stringEnd(String s, int i) {
    if (i >= s.length() || s.charAt(i) != '"') throw new IllegalArgumentException("string expected");
    for (i++; i < s.length(); i++) { if (s.charAt(i) == '\\') i++; else if (s.charAt(i) == '"') return i + 1; }
    throw new IllegalArgumentException("unterminated string");
  }
  private static String unquote(String s) {
    // Root member names are protocol ASCII names. Do not accept escaped aliases.
    if (s.indexOf('\\') >= 0) throw new IllegalArgumentException("escaped root key");
    return s.substring(1, s.length() - 1);
  }
  private static int valueEnd(String s, int i) {
    if (i >= s.length()) throw new IllegalArgumentException("value missing");
    char first = s.charAt(i);
    if (first == '"') return stringEnd(s, i);
    if (first != '{' && first != '[') {
      int p = i; while (p < s.length() && s.charAt(p) != ',' && s.charAt(p) != '}' && s.charAt(p) != ']') p++;
      return p;
    }
    char open = first, close = first == '{' ? '}' : ']'; int depth = 0;
    for (int p = i; p < s.length(); p++) {
      char c = s.charAt(p);
      if (c == '"') { p = stringEnd(s, p) - 1; continue; }
      if (c == open) depth++;
      else if (c == close && --depth == 0) return p + 1;
    }
    throw new IllegalArgumentException("unterminated composite");
  }
}