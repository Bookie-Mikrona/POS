package si.pos.zcsbridge

import android.content.Intent
import android.app.KeyguardManager
import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * Glavni zaslon — prikaže stanje HTTP strežnika in ZCS tiskalnika.
 * Ob odprtju samodejno zažene [PrintServerService] v ozadju.
 */
class MainActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private val fiscalInfo by lazy { si.bookie.fiscal.BookieFiscalHttpServer(applicationContext) }
    private val confirmAdmin = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()
    ) { if (it.resultCode == Activity.RESULT_OK) openAdmin() }
    private val refreshRunnable = object : Runnable {
        override fun run() {
            refreshStatus()
            handler.postDelayed(this, 2000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // Zaženi foreground servis
        startForegroundService(Intent(this, PrintServerService::class.java))
        findViewById<Button>(R.id.btnAdmin).setOnClickListener {
            val keyguard = getSystemService(KeyguardManager::class.java)
            val confirmation = keyguard?.createConfirmDeviceCredentialIntent(
                "Bookie lokalna administracija", "Potrdite dostop do fiskalnih nastavitev"
            )
            if (confirmation != null) confirmAdmin.launch(confirmation)
            else findViewById<TextView>(R.id.tvUrl).text = "Za lokalno administracijo najprej nastavite zaklep zaslona."
        }

        findViewById<Button>(R.id.btnStop).setOnClickListener {
            stopService(Intent(this, PrintServerService::class.java))
            finish()
        }
    }

    override fun onResume() {
        super.onResume()
        handler.post(refreshRunnable)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refreshRunnable)
    }

    override fun onDestroy() {
        fiscalInfo.close()
        super.onDestroy()
    }

    private fun refreshStatus() {
        // Ping lokalni strežnik za status
        Thread {
            val statusText = try {
                val url = java.net.URL("http://localhost:${PrintServerService.PORT}/status")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.connectTimeout = 1000
                conn.readTimeout = 1000
                if (conn.responseCode == 200) {
                    val body = conn.inputStream.bufferedReader().readText()
                    val json = org.json.JSONObject(body)
                    "HTTP strežnik: aktiven\nTiskalnik: ${json.optString("status", "?")}"
                } else {
                    "HTTP strežnik: napaka ${conn.responseCode}"
                }
            } catch (_: Exception) {
                "HTTP strežnik: se zaganja..."
            }

            runOnUiThread {
                findViewById<TextView>(R.id.tvStatus).text = statusText
                findViewById<TextView>(R.id.tvUrl).text =
                    "Tisk: http://localhost:${PrintServerService.PORT}/print\n" +
                    "Fiskalni API: http://127.0.0.1:17831/v1\n" +
                    "Koda za seznanitev je skrita"
            }
        }.start()
    }

    private fun revealPairingCode() {
        findViewById<TextView>(R.id.tvUrl).text =
            "Fiskalni API: http://127.0.0.1:17831/v1\nKoda za seznanitev: ${fiscalInfo.pairingCode()}\n" +
                "Koda poteče in je uporabna samo enkrat."
    }

    private fun openAdmin() {
        revealPairingCode()
        startActivity(Intent(this, si.bookie.fiscal.LocalCertificateAdminActivity::class.java))
    }
}
