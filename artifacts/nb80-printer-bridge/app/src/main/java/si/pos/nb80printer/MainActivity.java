package si.pos.nb80printer;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;

/**
 * Vstopna točka APK-ja.
 *
 * Ob zagonu:
 *  1. Zažene BridgeForegroundService.
 *  2. Storitev zažene HTTP strežnik in povezavo z NB80 PrinterService.
 *
 * Aktivnost se takoj pomakne v ozadje — tiska tiho, brez UI posegov.
 */
public class MainActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Preprosta statusna besedilna površina
        TextView tv = new TextView(this);
        tv.setPadding(32, 64, 32, 32);
        tv.setTextSize(16);
        tv.setText("NB80 Tiskalni Most 1.5\n\nHTTP most posluša na portu 8091.\nAPK je aktiven v ozadju.\n\nPOS aplikacija v brskalniku bo samodejno zaznala tiskalnik.");
        setContentView(tv);

        startForegroundService();

        // Pomakni v ozadje takoj po zagonu
        moveTaskToBack(true);
    }

    private void startForegroundService() {
        Intent serviceIntent = new Intent(this, BridgeForegroundService.class);
        startForegroundService(serviceIntent);
    }

}
