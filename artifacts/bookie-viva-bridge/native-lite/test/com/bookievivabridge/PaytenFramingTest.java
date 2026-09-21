package com.bookievivabridge;

/** JVM regression vector copied from the official JSON-ECR.ptp sale example. */
public final class PaytenFramingTest {
  public static void main(String[] args) throws Exception {
    String value = "{\"financial\":{\"amounts\":{\"base\":\"2450.00\",\"currencyCode\":\"RSD\"},\"options\":{\"language\":\"sr\",\"print\":\"true\"},\"transaction\":\"sale\"}}";
    String member = PaytenFraming.member("request", value);
    String expected = "7e4b173c326a217a98c3103582aacf1a401eb9dc874684233b1c5b5b2a06001855af37970d02a4e0949a3c4a092d6609644fb1282eba463eb5d5aa9e56823c29";
    if (PaytenFraming.length(member) != 139 || !expected.equals(PaytenFraming.sha512(member))) {
      throw new AssertionError("Official Payten sale framing vector failed");
    }
    String response = "\"response\" : { \"message\" : \"quoted \\\\\"value\\\\\"\", \"z\" : [ 1, 2 ] }";
    String raw = "{ \"header\":{\"length\":" + PaytenFraming.length(response) + "}, " + response + " }";
    if (!response.equals(PaytenFraming.rootMember(raw, "response"))) {
      throw new AssertionError("Exact response bytes were not preserved");
    }
    String tampered = response.replace("2 ]", "3 ]");
    if (PaytenFraming.sha512(response).equals(PaytenFraming.sha512(tampered))) {
      throw new AssertionError("Tampering was not detected");
    }
    if (!PaytenFraming.validCallbackAction(
        "com.bookievivabridge.payten.result.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG")) {
      throw new AssertionError("256-bit callback action rejected");
    }
    if (PaytenFraming.validCallbackAction("com.bookievivabridge.PAYTEN_RESULT")) {
      throw new AssertionError("Fixed callback action accepted");
    }
  }
}