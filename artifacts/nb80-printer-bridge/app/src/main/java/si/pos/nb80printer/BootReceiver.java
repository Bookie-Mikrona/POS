package si.pos.nb80printer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * Samodejno zažene BridgeForegroundService ob zagonu naprave.
 * Zahteva permission RECEIVE_BOOT_COMPLETED v manifestu.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "NB80Boot";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && !"android.intent.action.QUICKBOOT_POWERON".equals(intent.getAction())) {
            return;
        }
        Log.i(TAG, "Boot zaznан — zaganjam NB80 tiskalni most");
        Intent svc = new Intent(context, BridgeForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(svc);
        } else {
            context.startService(svc);
        }
    }
}
