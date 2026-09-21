package com.bookievivabridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.IBinder;
import android.util.Log;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.InetAddress;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import java.util.Map;

public final class BridgeResultService extends Service {
  static final String PREFS_NAME = "viva_bridge_results";
  private static final int PORT = 8092;
  private static final String CHANNEL = "viva_bridge_results";
  private volatile boolean running;
  private ServerSocket server;
  private BroadcastReceiver paytenReceiver;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    NotificationChannel channel = new NotificationChannel(
        CHANNEL, "Bookie Terminal Bridge", NotificationManager.IMPORTANCE_LOW);
    NotificationManager manager = getSystemService(NotificationManager.class);
    if (manager != null) manager.createNotificationChannel(channel);
    startForeground(2, new Notification.Builder(this, CHANNEL)
        .setContentTitle("Bookie Terminal Bridge")
        .setContentText("Čakam na rezultat plačila")
        .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
        .setOngoing(true)
        .build());
    startServer();
    registerPendingReceiver();
    return START_STICKY;
  }

  private synchronized void registerPendingReceiver() {
    if (paytenReceiver != null) {
      try { unregisterReceiver(paytenReceiver); } catch (Exception ignored) {}
      paytenReceiver = null;
    }
    IntentFilter filter = new IntentFilter();
    for (Map.Entry<String, ?> entry : getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getAll().entrySet()) {
      if (!entry.getKey().startsWith("pending.") || !(entry.getValue() instanceof String)) continue;
      try {
        String action = new JSONObject((String) entry.getValue()).getString("callbackAction");
        if (PaytenFraming.validCallbackAction(action)) filter.addAction(action);
      } catch (Exception ignored) {}
    }
    if (filter.countActions() == 0) return;
    paytenReceiver = new BroadcastReceiver() {
      @Override public void onReceive(Context context, Intent intent) {
        String raw = intent.getStringExtra("ResponseResult");
        if (raw == null) raw = intent.getStringExtra("ecrJson");
        PaytenReceiver.handle(context, intent.getAction(), raw);
      }
    };
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      registerReceiver(paytenReceiver, filter, Context.RECEIVER_EXPORTED);
    } else {
      registerReceiver(paytenReceiver, filter);
    }
  }

  private synchronized void startServer() {
    if (running) return;
    running = true;
    new Thread(new Runnable() {
      @Override
      public void run() {
        try {
          server = new ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"));
          while (running) {
            Socket socket = server.accept();
            handle(socket);
          }
        } catch (Exception error) {
          if (running) Log.e("BookieVivaBridge", "Result server failed", error);
        }
      }
    }, "viva-result-server").start();
  }

  private void handle(Socket socket) {
    try (Socket client = socket) {
      BufferedReader reader = new BufferedReader(
          new InputStreamReader(client.getInputStream(), StandardCharsets.US_ASCII));
      String request = reader.readLine();
      if (request == null) return;
      String[] parts = request.split(" ");
      String target = parts.length > 1 ? parts[1] : "/";
       String origin = "";
       while (true) {
        String line = reader.readLine();
        if (line == null || line.isEmpty()) break;
         if (line.regionMatches(true, 0, "Origin:", 0, 7)) origin = line.substring(7).trim();
      }

      String body = "{\"ok\":true,\"pending\":true}";
      int status = 200;
       if (target.startsWith("/identity")) {
         body = new JSONObject().put("ok", true).put("publicKeyBase64Url", BridgeIdentity.publicKeyBase64Url())
             .put("keyId", BridgeIdentity.keyId()).toString();
       } else if (target.startsWith("/payten-result?")) {
         String attemptId = queryValue(target, "attemptId");
         String pollToken = queryValue(target, "pollToken");
         SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
         String envelope = (attemptId.isEmpty() || pollToken.isEmpty()) ? null
             : prefs.getString("result." + attemptId + "." + pollToken, null);
         if (envelope == null) body = "{\"ok\":true,\"pending\":true}";
         else body = new JSONObject().put("ok", true).put("pending", false)
             .put("envelope", new JSONObject(envelope)).toString();
       } else if (target.startsWith("/result?")) {
        String key = queryValue(target, "clientTransactionId");
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String returnUrl = key.isEmpty() ? null : prefs.getString(key, null);
        if (returnUrl != null) {
          body = new JSONObject()
              .put("ok", true)
              .put("pending", false)
              .put("returnUrl", returnUrl)
              .toString();
        }
      } else if (!target.startsWith("/status")) {
        status = 404;
        body = "{\"ok\":false,\"error\":\"Endpoint ne obstaja\"}";
      }
       write(client, status, body, allowedOrigin(origin));
    } catch (Exception error) {
      Log.e("BookieVivaBridge", "Result request failed", error);
    }
  }

  private static String queryValue(String target, String name) throws Exception {
    int q = target.indexOf('?');
    if (q < 0) return "";
    for (String item : target.substring(q + 1).split("&")) {
      String[] pair = item.split("=", 2);
      if (pair.length == 2 && name.equals(URLDecoder.decode(pair[0], "UTF-8"))) {
        return URLDecoder.decode(pair[1], "UTF-8");
      }
    }
    return "";
  }

   private static String allowedOrigin(String origin) {
     if (origin != null && origin.matches("https://[a-zA-Z0-9-]+\\.(replit\\.app|replit\\.dev)(:\\d+)?")) return origin;
     return "";
   }

   private static void write(Socket socket, int status, String body, String origin) throws Exception {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    String head = "HTTP/1.1 " + status + (status == 200 ? " OK" : " Not Found") + "\r\n"
        + "Content-Type: application/json; charset=utf-8\r\n"
        + "Content-Length: " + bytes.length + "\r\n"
         + (origin.isEmpty() ? "" : "Access-Control-Allow-Origin: " + origin + "\r\nVary: Origin\r\n")
        + "Access-Control-Allow-Methods: GET, OPTIONS\r\n"
        + "Access-Control-Allow-Headers: Content-Type, Access-Control-Request-Private-Network\r\n"
        + "Access-Control-Allow-Private-Network: true\r\n"
        + "Connection: close\r\n\r\n";
    OutputStream output = socket.getOutputStream();
    output.write(head.getBytes(StandardCharsets.US_ASCII));
    output.write(bytes);
    output.flush();
  }

  @Override
  public void onDestroy() {
    running = false;
    if (paytenReceiver != null) {
      try { unregisterReceiver(paytenReceiver); } catch (Exception ignored) {}
      paytenReceiver = null;
    }
    try { if (server != null) server.close(); } catch (Exception ignored) {}
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }
}