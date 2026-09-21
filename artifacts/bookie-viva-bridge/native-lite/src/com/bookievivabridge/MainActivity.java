package com.bookievivabridge;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;

public class MainActivity extends Activity {
  private static final Set<String> ALLOWED_VIVA_PACKAGES = new HashSet<>(Arrays.asList(
      "com.vivawallet.spoc.payapp",
      "com.vivawallet.spoc.payapp.demo"
  ));

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleIntent(getIntent());
  }

  @Override
  protected void onNewIntent(Intent newIntent) {
    super.onNewIntent(newIntent);
    setIntent(newIntent);
    handleIntent(newIntent);
  }

  protected void handleIntent(Intent sourceIntent) {
    if (sourceIntent != null && sourceIntent.getBooleanExtra("paytenDone", false)) {
      finishAndRemoveTask();
      return;
    }
    Uri incoming = sourceIntent == null ? null : sourceIntent.getData();
    if (incoming == null) {
      startBridgeService();
      finishAndRemoveTask();
      return;
    }

    try {
      require("bookie-viva-bridge".equals(incoming.getScheme()), "Neveljavna URI shema.");
      String host = incoming.getHost();
      if ("pair".equals(host)) {
        require(incoming.getPathSegments().isEmpty(), "Neveljavna Pair pot.");
        BridgeIdentity.publicKey();
        startBridgeService();
        finishAndRemoveTask();
        return;
      }
      require("pay".equals(host) || "result".equals(host) || "payten".equals(host), "Neveljavna Bridge pot.");
      require(!incoming.getPathSegments().isEmpty(), "Manjka kontekst plačila.");
      String encodedState = incoming.getPathSegments().get(0);
      BridgeState state = decodeState(encodedState);

      if ("payten".equals(host)) {
        openPayten(state);
      } else if ("pay".equals(host)) {
        openViva(incoming, encodedState);
      } else {
        returnToBookie(incoming, state);
      }
    } catch (Exception error) {
      showMessage(
          "Povezava ni uspela",
          error.getMessage() == null ? "Bookie Viva zahtevka ni bilo mogoče obdelati." : error.getMessage()
      );
    }
  }

  private BridgeState decodeState(String encodedState) throws Exception {
    String padding = "====".substring(0, (4 - encodedState.length() % 4) % 4);
    byte[] bytes = Base64.decode(encodedState + padding, Base64.URL_SAFE | Base64.NO_WRAP);
    JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    require(json.optInt("v") == 1, "Neveljavna različica konteksta.");
    if (json.has("attemptId")) return decodePaytenState(json);
    String returnUrl = json.getString("returnUrl");
    String clientTransactionId = json.getString("clientTransactionId");
    require(!clientTransactionId.trim().isEmpty(), "Manjka identifikator plačila.");
    require(isAllowedReturnUrl(returnUrl), "Povratni POS naslov ni dovoljen.");
    return new BridgeState(returnUrl, clientTransactionId);
  }

  private BridgeState decodePaytenState(JSONObject json) throws Exception {
    String attemptId = json.getString("attemptId");
    String pollToken = json.getString("pollToken");
    String keyId = json.getString("bridgeKeyId");
    int amount = json.getInt("amountCents");
    require(attemptId.matches("[A-Za-z0-9_-]{1,128}"), "Neveljaven attemptId.");
    require(amount > 0, "Znesek mora biti pozitiven.");
    require("EUR".equals(json.getString("currency")), "Podprta je samo valuta EUR.");
    require(pollToken.matches("[A-Za-z0-9_-]{22,128}"), "Neveljaven pollToken.");
    require(keyId.equals(BridgeIdentity.keyId()), "Bridge ključ se ne ujema.");
    return new BridgeState(attemptId, amount, pollToken);
  }

  private boolean isAllowedReturnUrl(String value) {
    Uri url = Uri.parse(value);
    if (!"https".equals(url.getScheme()) || !url.getPath().endsWith("/pos/blagajna")) return false;
    String hostname = url.getHost() == null ? "" : url.getHost().toLowerCase();
    return "bookie-erp.replit.app".equals(hostname)
        || hostname.endsWith(".replit.app")
        || hostname.endsWith(".replit.dev");
  }

  private void openViva(Uri incoming, String encodedState) throws Exception {
    String target = incoming.getQueryParameter("target");
    require(target != null, "Manjka Viva zahtevek.");
    Intent vivaIntent = Intent.parseUri(target, Intent.URI_INTENT_SCHEME);
    Uri vivaUrl = vivaIntent.getData();
    require(vivaUrl != null, "Viva zahtevek nima naslova.");
    require("vivapayclient".equals(vivaUrl.getScheme()), "Neveljavna Viva shema.");
    require("pay".equals(vivaUrl.getHost()) && "/v1".equals(vivaUrl.getPath()), "Neveljavna Viva pot.");
    require(ALLOWED_VIVA_PACKAGES.contains(vivaIntent.getPackage()), "Viva paket ni dovoljen.");
    require(
        ("bookie-viva-bridge://result/" + encodedState).equals(vivaUrl.getQueryParameter("callback")),
        "Viva callback ne ustreza plačilu."
    );

    // Lokalni rezultatni kanal mora živeti, ko se Chrome umakne v ozadje.
    Intent resultService = new Intent(this, BridgeResultService.class);
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      startForegroundService(resultService);
    } else {
      startService(resultService);
    }

    // Rezultat hrani foreground service, zato prazna Bridge Activity ne sme
    // ostati pod Vivo. Sicer se po zaprtju callback Activity pokaže Bridge
    // namesto prvotnega Chrome/POS taska.
    vivaIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS);
    startActivity(vivaIntent);
    finishAndRemoveTask();
  }

  private void openPayten(BridgeState state) throws Exception {
    require(state.isPayten(), "Neveljaven Payten kontekst.");
    byte[] random = new byte[32]; new SecureRandom().nextBytes(random);
    String requestId = BridgeIdentity.b64(random);
    byte[] callbackRandom = new byte[32]; new SecureRandom().nextBytes(callbackRandom);
    String callbackAction = "com.bookievivabridge.payten.result." + BridgeIdentity.b64(callbackRandom);
    require(PaytenFraming.validCallbackAction(callbackAction), "Neveljaven Payten callback.");
    String ecr = deterministicEcr(state.clientTransactionId);
    JSONObject pending = new JSONObject().put("attemptId", state.clientTransactionId)
        .put("amountCents", state.amountCents).put("pollToken", state.pollToken).put("ecr", ecr)
        .put("callbackAction", callbackAction);
    getSharedPreferences(BridgeResultService.PREFS_NAME, Context.MODE_PRIVATE).edit()
        .putString("pending." + requestId, pending.toString()).apply();
    startBridgeService();
    Intent payten = new Intent("com.payten.ecr.action").setPackage("com.payten.paytenapos")
        .putExtra("ecrJson", PaytenProtocol.sale(ecr, requestId, state.amountCents))
        .putExtra("senderIntentFilter", callbackAction)
        .putExtra("senderPackage", "com.bookievivabridge")
        .putExtra("senderClass", "com.bookievivabridge.MainActivity")
        .addFlags(Intent.FLAG_INCLUDE_STOPPED_PACKAGES);
    sendBroadcast(payten);
    finishAndRemoveTask();
  }

  private void startBridgeService() {
    Intent service = new Intent(this, BridgeResultService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(service); else startService(service);
  }

  private static String deterministicEcr(String attemptId) throws Exception {
    byte[] d = MessageDigest.getInstance("SHA-256").digest(attemptId.getBytes(StandardCharsets.UTF_8));
    long n = ((long) (d[0] & 0xff) << 24) | ((long) (d[1] & 0xff) << 16)
        | ((long) (d[2] & 0xff) << 8) | (long) (d[3] & 0xff);
    return String.format("%08d", n % 100000000L);
  }

  private void returnToBookie(Uri incoming, BridgeState state) {
    String callbackClientId = value(incoming.getQueryParameter("clientTransactionId"));
    require(!callbackClientId.isEmpty() && callbackClientId.equals(state.clientTransactionId),
        "Viva callback ne ustreza začetemu plačilu.");

    String status = value(incoming.getQueryParameter("status"));
    String transactionId = value(incoming.getQueryParameter("transactionId"));
    Uri.Builder returnUrl = Uri.parse(state.returnUrl).buildUpon()
        .appendQueryParameter("vivaTapToPay", "1")
        .appendQueryParameter("clientTransactionId", callbackClientId);

    if ("success".equals(status) && !transactionId.isEmpty()) {
      returnUrl.appendQueryParameter("status", "success")
          .appendQueryParameter("transactionId", transactionId);
    } else {
      returnUrl.appendQueryParameter("status", status.isEmpty() ? "unknown" : status);
      appendIfPresent(returnUrl, "errorCode", incoming.getQueryParameter("errorCode"));
      appendIfPresent(returnUrl, "message", incoming.getQueryParameter("message"));
    }

    getSharedPreferences(BridgeResultService.PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .putString(state.clientTransactionId, returnUrl.build().toString())
        .apply();

    // Ne odpiraj HTTPS ACTION_VIEW: brskalnik ga lahko pretvori v nov zavihek.
    // Samsung One UI po finishAndRemoveTask() včasih pusti prazen Bridge task
    // v ospredju. Premik celotnega callback taska v ozadje najprej razkrije
    // prvotni brskalnik/POS; noHistory CallbackActivity se nato zapre.
    if ("samsung".equalsIgnoreCase(Build.MANUFACTURER)) {
      boolean moved = moveTaskToBack(true);
      if (moved) {
        finish();
      } else {
        finishAndRemoveTask();
      }
      return;
    }

    // Na drugih napravah ohrani preverjeno vedenje. POS rezultat prevzame na
    // localhost:8092 in znotraj istega zavihka izvede location.replace().
    finishAndRemoveTask();
  }

  private void appendIfPresent(Uri.Builder builder, String key, String value) {
    if (value != null && !value.trim().isEmpty()) builder.appendQueryParameter(key, value);
  }

  private String value(String value) {
    return value == null ? "" : value.trim();
  }

  private void require(boolean condition, String message) {
    if (!condition) throw new IllegalArgumentException(message);
  }

  private void showMessage(String title, String message) {
    float density = getResources().getDisplayMetrics().density;
    int padding = (int) (24 * density);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setGravity(Gravity.CENTER);
    root.setPadding(padding, padding, padding, padding);
    root.setBackgroundColor(Color.WHITE);

    TextView titleView = new TextView(this);
    titleView.setText(title);
    titleView.setTextSize(24);
    titleView.setTextColor(Color.rgb(20, 24, 32));
    titleView.setGravity(Gravity.CENTER);
    root.addView(titleView);

    TextView messageView = new TextView(this);
    messageView.setText(message);
    messageView.setTextSize(16);
    messageView.setTextColor(Color.rgb(82, 90, 105));
    messageView.setGravity(Gravity.CENTER);
    messageView.setPadding(0, (int) (16 * density), 0, 0);
    root.addView(messageView);
    setContentView(root);
  }

  private static final class BridgeState {
    final String returnUrl;
    final String clientTransactionId;
    final int amountCents;
    final String pollToken;

    BridgeState(String returnUrl, String clientTransactionId) {
      this.returnUrl = returnUrl;
      this.clientTransactionId = clientTransactionId;
      this.amountCents = 0;
      this.pollToken = null;
    }
    BridgeState(String attemptId, int amountCents, String pollToken) {
      this.returnUrl = null;
      this.clientTransactionId = attemptId;
      this.amountCents = amountCents;
      this.pollToken = pollToken;
    }
    boolean isPayten() { return pollToken != null; }
  }
}