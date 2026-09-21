package com.bookievivabridge;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Shared validation/signing path used only by the capability-bound runtime receiver. */
public final class PaytenReceiver {
  public static void handle(Context context, String callbackAction, String raw) {
    try {
      if (raw == null || !PaytenProtocol.validResponse(raw)) return;
      JSONObject root = new JSONObject(raw), header = root.getJSONObject("header");
      String requestId = header.getString("requestID");
      SharedPreferences p = context.getSharedPreferences(BridgeResultService.PREFS_NAME, Context.MODE_PRIVATE);
      String pending = p.getString("pending." + requestId, null);
      if (pending == null) return;
      JSONObject pendingJson = new JSONObject(pending), fin = root.getJSONObject("response").getJSONObject("financial");
      if (!callbackAction.equals(pendingJson.getString("callbackAction"))) return;
      JSONObject id = fin.getJSONObject("id"), amounts = fin.getJSONObject("amounts");
      String ecr = id.optString("ecr"), result = fin.getJSONObject("result").optString("code");
      String reference = id.optString("reference"), invoice = id.optString("invoice");
      if (!"Approved".equals(result) || !pendingJson.getString("ecr").equals(ecr)
          || !PaytenProtocol.decimal(pendingJson.getInt("amountCents")).equals(amounts.getString("total"))
          || !"EUR".equals(amounts.getString("currencyCode")) || (reference.isEmpty() && invoice.isEmpty())) return;
      JSONObject payload = new JSONObject().put("version", 1).put("keyId", BridgeIdentity.keyId())
          .put("attemptId", pendingJson.getString("attemptId")).put("requestId", requestId)
          .put("receivedAt", System.currentTimeMillis()).put("resultCode", result)
          .put("amount", amounts.getString("total")).put("currency", "EUR")
          .put("providerReference", reference.isEmpty() ? invoice : reference)
          .put("invoice", invoice).put("ecr", ecr)
          .put("responseHash", PaytenFraming.sha256(raw.getBytes(StandardCharsets.UTF_8)));
      byte[] bytes = payload.toString().getBytes(StandardCharsets.UTF_8);
      JSONObject envelope = new JSONObject().put("payloadBase64Url", BridgeIdentity.b64(bytes))
          .put("signatureBase64Url", BridgeIdentity.sign(bytes)).put("keyId", BridgeIdentity.keyId());
      p.edit().putString("result." + pendingJson.getString("attemptId") + "." + pendingJson.getString("pollToken"),
          envelope.toString()).remove("pending." + requestId).apply();
      context.stopService(new android.content.Intent(context, BridgeResultService.class));
      context.startActivity(new Intent(context, MainActivity.class).putExtra("paytenDone", true)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
    } catch (Exception ignored) { }
  }
}