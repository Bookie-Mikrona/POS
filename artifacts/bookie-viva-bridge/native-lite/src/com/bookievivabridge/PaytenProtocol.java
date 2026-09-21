package com.bookievivabridge;

import org.json.JSONObject;

/** JSON-ECR framing used by the Payten protocol.  The hash is an integrity
 * check for the ECR message only; it is deliberately not used as an attestation. */
public final class PaytenProtocol {
  private PaytenProtocol() {}

  public static String sale(String ecr, String requestId, int cents) throws Exception {
    JSONObject financial = new JSONObject()
        .put("transaction", "sale")
        .put("id", new JSONObject().put("ecr", ecr))
        .put("amounts", new JSONObject()
            .put("base", decimal(cents)).put("total", decimal(cents)).put("currencyCode", "EUR"));
    JSONObject request = new JSONObject().put("financial", financial);
    String data = PaytenFraming.member("request", request.toString());
    // The official .ptp vector hashes the root member, without root braces.
    return new JSONObject().put("header", new JSONObject()
        .put("length", PaytenFraming.length(data))
        .put("hash", PaytenFraming.sha512(data)).put("requestID", requestId).put("version", "02"))
        .put("request", request).toString();
  }

  public static boolean validResponse(String raw) {
    try {
      JSONObject whole = new JSONObject(raw);
      JSONObject header = whole.getJSONObject("header");
      String data = PaytenFraming.rootMember(raw, "response");
      return header.getInt("length") == PaytenFraming.length(data)
          && PaytenFraming.sha512(data).equalsIgnoreCase(header.getString("hash"));
    } catch (Exception e) { return false; }
  }

  public static String decimal(int cents) {
    return (cents / 100) + "." + (cents % 100 < 10 ? "0" : "") + (cents % 100);
  }

}