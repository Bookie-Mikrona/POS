package si.pos.zcsbridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Ob vklopu naprave samodejno zažene PrintServerService.
 * Zahteva dovoljenje RECEIVE_BOOT_COMPLETED v manifestu.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val allowed = setOf(
            Intent.ACTION_BOOT_COMPLETED,                        // po unlocku (Android 7+)
            "android.intent.action.LOCKED_BOOT_COMPLETED",      // takoj ob zagonu (Direct Boot)
            "android.intent.action.QUICKBOOT_POWERON",          // ZCS/Qualcomm hitri zagon
            "com.htc.intent.action.QUICKBOOT_POWERON",          // HTC varianta
        )
        if (intent.action !in allowed) return

        Log.i(TAG, "Avtozagon ob zagonu naprave (${intent.action}) — zaganjam PrintServerService")

        val serviceIntent = Intent(context, PrintServerService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Ni mogoče zagnati PrintServerService: ${e.message}")
        }
    }
}
