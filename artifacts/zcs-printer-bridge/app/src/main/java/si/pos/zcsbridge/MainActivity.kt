package si.pos.zcsbridge

import android.content.Intent
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
                    "POS aplikacija naj uporablja:\nhttp://localhost:${PrintServerService.PORT}/print"
            }
        }.start()
    }
}
