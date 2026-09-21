package si.pos.nb80printer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import java.io.IOException;

/**
 * Foreground Service — drži APK živ v ozadju.
 * Android 8+ zahteva foreground service za procese, ki tečejo v ozadju.
 * Prikazuje trajno obvestilo v obvestilni vrstici.
 */
public class BridgeForegroundService extends Service {

    private static final String TAG = "NB80Bridge";
    private static final String CH = "nb80_bridge_ch";
    private BridgeHttpServer mServer;

    @Override
    public void onCreate() {
        super.onCreate();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel();

        Notification notif = new Notification.Builder(this, CH)
                .setContentTitle("NB80 Tiskalni Most")
                .setContentText("Aktivno · port 8091")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .build();

        startForeground(1, notif);
        // Strežnik zaženi šele po vzpostavitvi foreground storitve. Če je
        // Android storitev ponovno zagnal brez novega procesa, se bo tukaj
        // poskusil vzpostaviti tudi manjkajoči HTTP strežnik.
        startHttpServer();
        return START_STICKY;
    }

    private void startHttpServer() {
        if (mServer != null) return;
        try {
            // Strežnik mora živeti v storitvi, ne v aktivnosti. Android lahko
            // aktivnost uniči, medtem ko foreground service ostane aktiven.
            mServer = new BridgeHttpServer(this);
            Log.i(TAG, "HTTP strežnik zagnan v foreground storitvi na portu 8091");
        } catch (IOException e) {
            Log.e(TAG, "Ne morem zagnati HTTP strežnika", e);
        }
    }

    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(
                CH, "NB80 Tiskalni Most", NotificationManager.IMPORTANCE_LOW);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (mServer != null) {
            mServer.stop();
            mServer = null;
        }
        super.onDestroy();
    }
}
