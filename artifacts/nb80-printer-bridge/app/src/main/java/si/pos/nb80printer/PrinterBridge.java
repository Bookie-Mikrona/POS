package si.pos.nb80printer;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.os.RemoteException;
import android.util.Log;

import net.nyx.printerservice.print.IPrinterService;
import net.nyx.printerservice.print.PrintTextFormat;

/**
 * Upravlja AIDL Binder povezavo z NB80 PrinterService.
 * Singleton — ena instanca za celoten APK.
 *
 * PrinterService:
 *   package: com.incar.printerservice
 *   action:  com.incar.printerservice.IPrinterService
 *   AIDL:    net.nyx.printerservice.print.IPrinterService
 *
 * Encoding: NB80 PrinterService sprejema UTF-8 nativno.
 * Java String je Unicode — ni potrebno bajt kodiranje (ne Windows-1250, ne iconv).
 * JSON telo iz NanoHTTPD je prebrano kot UTF-8, stringi se posredujejo
 * direktno v printText() brez pretvorbe.
 *
 * Dokumentacija SDK: https://github.com/SZNoryox/PrinterClient/tree/a13
 */
public class PrinterBridge {

    private static final String TAG = "NB80Bridge";

    private static final String PKG    = "com.incar.printerservice";
    private static final String ACTION = "com.incar.printerservice.IPrinterService";

    private static PrinterBridge sInstance;

    private IPrinterService mPrinterService;
    private boolean mBound = false;
    private final Context mContext;

    private final ServiceConnection mConn = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            mPrinterService = IPrinterService.Stub.asInterface(service);
            mBound = true;
            Log.i(TAG, "PrinterService connected: " + name.flattenToShortString());
        }
        @Override
        public void onServiceDisconnected(ComponentName name) {
            mPrinterService = null;
            mBound = false;
            Log.w(TAG, "PrinterService disconnected — rebind čez 5s");
            // Samodejno rebind čez 5 sekund
            android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
            h.postDelayed(PrinterBridge.this::bind, 5000);
        }
    };

    private PrinterBridge(Context ctx) {
        mContext = ctx.getApplicationContext();
        bind();
    }

    public static synchronized PrinterBridge getInstance(Context ctx) {
        if (sInstance == null) sInstance = new PrinterBridge(ctx);
        return sInstance;
    }

    private void bind() {
        Intent intent = new Intent(ACTION);
        intent.setPackage(PKG);
        boolean ok = mContext.bindService(intent, mConn, Context.BIND_AUTO_CREATE);
        if (!ok) Log.e(TAG, "bindService vrnil false — printerservice ni nameščen?");
    }

    /** Vrne true kadar je Binder aktiven. */
    public boolean isReady() {
        return mBound && mPrinterService != null;
    }

    public static class Diagnostics {
        public final boolean binderReady;
        public final String  serviceVersion; // null če ni dosegljiv
        public final int     printerStatus;  // 0=OK, >0=napaka; -1 če ni dosegljiv
        public final String  printerModel;   // null če ni dosegljiv

        Diagnostics(boolean binderReady, String serviceVersion, int printerStatus, String printerModel) {
            this.binderReady    = binderReady;
            this.serviceVersion = serviceVersion;
            this.printerStatus  = printerStatus;
            this.printerModel   = printerModel;
        }
    }

    /**
     * Pridobi diagnostične podatke — kliče se iz BridgeHttpServer na GET /diagnostics.
     * Ne meče izjeme; napake vrne kot null polja.
     */
    public Diagnostics getDiagnostics() {
        if (!isReady()) return new Diagnostics(false, null, -1, null);
        String version = null;
        int    status  = -1;
        String model   = null;
        try { version = mPrinterService.getServiceVersion(); } catch (RemoteException ignored) {}
        try { status  = mPrinterService.getPrinterStatus();  } catch (RemoteException ignored) {}
        try {
            String[] modelArr = new String[1];
            mPrinterService.getPrinterModel(modelArr);
            model = modelArr[0];
        } catch (RemoteException ignored) {}
        return new Diagnostics(true, version, status, model);
    }

    /**
     * Natisni vrstice JSON računa.
     *
     * @param linee     array besedilnih vrstic (UTF-8 nizi)
     * @param formati   array formatov: 'B'=bold, 'N'=normal, 'C'=center, 'R'=right, 'L'=left
     * @param qrUrl     preverjeni FURS URL za QR kodo ali null
     * @param zoi       ZOI za CODE128 črtno kodo ali null
     */
    public synchronized void printReceipt(
            String[] linee,
            String[] formati,
            String qrUrl,
            String zoi
    ) throws RemoteException {
        if (!isReady()) throw new RemoteException("PrinterService ni inicializiran");

        for (int i = 0; i < linee.length; i++) {
            String fmt     = (formati != null && i < formati.length) ? formati[i] : "N";

            PrintTextFormat tf = new PrintTextFormat();

            // MONOSPACE (font=4) — fiksna širina znakov; preslednice enako široke kot črke
            tf.setFont(4);

            // Poravnava
            if (fmt.contains("C"))      tf.setAli(1); // center
            else if (fmt.contains("R")) tf.setAli(2); // right
            else                        tf.setAli(0); // left (privzeto)

            // Enak format kot preverjeni NYX most: SDK uporablja px.
            if (fmt.contains("H")) {
                tf.setStyle(1);
                tf.setTextSize(28);
            } else if (fmt.contains("B")) {
                tf.setStyle(1);
                tf.setTextSize(24);
            } else {
                tf.setStyle(0);
                tf.setTextSize(24);
            }

            String line = linee[i] == null ? "" : linee[i];
            int ret = mPrinterService.printText(line, tf);
            if (ret != 0) throw new RemoteException("printText vrnil kodo " + ret);
        }

        if (qrUrl != null && !qrUrl.trim().isEmpty()) {
            int ret = mPrinterService.printQrCode(qrUrl, 200, 200, 1);
            if (ret != 0) throw new RemoteException("printQrCode vrnil kodo " + ret);
        }

        // Pomik papirja + samodejni rez
        int ret = mPrinterService.printEndAutoOut();
        if (ret != 0) throw new RemoteException("printEndAutoOut vrnil kodo " + ret);
        try { mPrinterService.paperOut(144); } catch (RemoteException ignored) {}
    }

}
