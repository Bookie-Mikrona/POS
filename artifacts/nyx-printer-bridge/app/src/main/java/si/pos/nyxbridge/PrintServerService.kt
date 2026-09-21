package si.pos.nyxbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

/**
 * Foreground servis z minimalnim HTTP strežnikom (brez zunanjih odvisnosti).
 * Posluša na localhost:[PORT] — ENAK port in endpointi kot ZcsPrinterBridge,
 * da POS frontend ne potrebuje nobenih sprememb.
 *
 * GET  /status      — JSON stanje tiskalnika
 * GET  /diagnostics — diagnostika: NYX paketi, stanje
 * POST /print       — telo = surovi ESC/POS bajti (→ printEscposData)
 * POST /print-text  — telo = UTF-8 JSON { linee, formati, qrUrl, qrBase64, zoi }
 * OPTIONS *         — CORS preflight
 *
 * Telo se bere kot surovi bajti (ne CharArray) da pravilno obravnavamo
 * UTF-8 večbajtne znake (č, š, ž) pri Content-Length izračunu.
 */
class PrintServerService : Service() {

    companion object {
        /** ISTI port kot ZcsPrinterBridge — POS ne potrebuje sprememb */
        const val PORT = 8090
        private const val TAG = "PrintServerService"
        private const val CHANNEL_ID = "nyx_print_bridge"
        private const val NOTIF_ID = 1

        private val CORS_HEADERS = listOf(
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type, X-Requested-With, Access-Control-Request-Private-Network",
            "Access-Control-Allow-Private-Network: true",
        )
    }

    private lateinit var bridge: NyxPrinterBridge
    private lateinit var fiscalServer: si.bookie.fiscal.BookieFiscalHttpServer
    private val executor = Executors.newCachedThreadPool()

    @Volatile private var running = false
    private var serverSocket: ServerSocket? = null

    override fun onCreate() {
        super.onCreate()
        bridge = NyxPrinterBridge(applicationContext)
        fiscalServer = si.bookie.fiscal.BookieFiscalHttpServer(applicationContext, printer = object : si.bookie.fiscal.FiscalPrinter {
            override val paperWidthMm = 80
            override fun isHealthy() = bridge.isReady()
            override fun status() = bridge.statusText()
            override fun printLegal(lines: List<String>, qrData: String?, zoi: String?, reprint: Boolean): Result<Unit> {
                val result = bridge.printText(lines, null, qrData, null, zoi)
                return if (result.ok) Result.success(Unit) else Result.failure(IllegalStateException(result.error))
            }
        })

        // startForeground MORA biti klican v 5 sekundah od startForegroundService().
        // bridge.connect() vzpostavi bindService → ne blokira tega okna.
        startForeground(NOTIF_ID, buildNotification())
        startHttpServer()
        fiscalServer.start()
        si.bookie.fiscal.FiscalSyncWorker.schedule(applicationContext)

        // Inicializacija tiskalnika v ozadju — ne blokira 5-sekundnega okna
        executor.submit {
            bridge.connect()
            updateNotification(
                if (bridge.isReady()) "NYX tiskalnik pripravljen ✓ (80mm)"
                else "Servis aktiven — NYX tiskalnik se inicializira"
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        running = false
        serverSocket?.close()
        fiscalServer.close()
        bridge.disconnect()
        executor.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── HTTP strežnik ────────────────────────────────────────────────────────

    private fun startHttpServer() {
        running = true
        executor.submit {
            try {
                val srv = java.net.ServerSocket().apply {
                    reuseAddress = true
                    // Never expose the printer/fiscal bridge on Wi-Fi or Ethernet.
                    bind(java.net.InetSocketAddress(java.net.InetAddress.getLoopbackAddress(), PORT))
                }
                serverSocket = srv
                srv.use {
                    Log.i(TAG, "HTTP strežnik posluša na portu $PORT")
                    updateNotification("HTTP strežnik aktiven na localhost:$PORT")
                    while (running) {
                        try {
                            val socket = it.accept()
                            executor.submit { handleConnection(socket) }
                        } catch (_: Exception) {
                            if (running) Log.e(TAG, "Accept napaka")
                        }
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Strežnik ni mogel zagnati na portu $PORT: ${e.message}")
                updateNotification("NAPAKA: vrata $PORT zasedena — znova zaženite APK")
            }
        }
    }

    private fun updateNotification(text: String) {
        try {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            val pi = android.app.PendingIntent.getActivity(
                this, 0,
                Intent(this, MainActivity::class.java),
                android.app.PendingIntent.FLAG_IMMUTABLE
            )
            val notif = Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("NYX tiskalni most (NB80)")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_send)
                .setContentIntent(pi)
                .setOngoing(true)
                .build()
            nm.notify(NOTIF_ID, notif)
        } catch (_: Exception) {}
    }

    /**
     * Bere celotno HTTP zahtevo kot surove bajte.
     * Glave: do \r\n\r\n; telo: natanko content-length bajtov.
     */
    private fun handleConnection(socket: Socket) {
        socket.use {
            try {
                val input  = it.inputStream
                val output = it.outputStream

                // 1. Preberi glave kot bajte do \r\n\r\n
                val headerBuf = ByteArrayOutputStream()
                var b0 = -1; var b1 = -1; var b2 = -1
                while (true) {
                    val b = input.read()
                    if (b < 0) return
                    headerBuf.write(b)
                    if (b2 == '\r'.code && b1 == '\n'.code && b0 == '\r'.code && b == '\n'.code) break
                    b2 = b1; b1 = b0; b0 = b
                }

                val headerText = headerBuf.toString("UTF-8")
                val lines = headerText.trimEnd().split("\r\n")
                if (lines.isEmpty()) return

                val requestParts = lines[0].split(" ")
                if (requestParts.size < 2) return
                val method = requestParts[0].uppercase()
                val path   = requestParts[1]

                val headers = mutableMapOf<String, String>()
                for (i in 1 until lines.size) {
                    val idx = lines[i].indexOf(':')
                    if (idx > 0) {
                        headers[lines[i].substring(0, idx).trim().lowercase()] =
                            lines[i].substring(idx + 1).trim()
                    }
                }

                Log.d(TAG, "HTTP $method $path")

                when {
                    method == "OPTIONS" ->
                        sendJson(output, 200, """{"ok":true}""")

                    method == "GET" && path == "/status" -> {
                        val isReady = bridge.isReady()
                        // model:"nyx" — POS ga prebere in pokliče /api/print/racun/:id/nb80 (40 kolon)
                        val json = """{"ok":$isReady,"status":"${bridge.statusText()}","port":$PORT,"model":"nyx"}"""
                        sendJson(output, 200, json)
                    }

                    method == "GET" && path == "/diagnostics" -> {
                        val nyxPkgs = bridge.getInstalledNyxPackages()
                        val pkgsJson = nyxPkgs.joinToString(",") { "\"$it\"" }
                        sendJson(output, 200, """{"nyxPackages":[$pkgsJson],"bridgeReady":${bridge.isReady()},"status":"${bridge.statusText()}","paperWidth":576}""")
                    }

                    method == "POST" && path == "/print" -> {
                        val bodyBytes = readBody(input, headers)
                        val result = bridge.print(bodyBytes)
                        if (result.ok) {
                            sendJson(output, 200, """{"ok":true}""")
                        } else {
                            val err = (result.error ?: "Napaka").replace("\"", "'")
                            sendJson(output, 500, """{"ok":false,"error":"$err"}""")
                        }
                    }

                    method == "POST" && path == "/print-text" -> {
                        val bodyBytes = readBody(input, headers)
                        if (bodyBytes.isEmpty()) {
                            sendJson(output, 400, """{"ok":false,"error":"Prazno telo"}""")
                            return
                        }
                        try {
                            val bodyStr = String(bodyBytes, Charsets.UTF_8)
                            val json = org.json.JSONObject(bodyStr)
                            val lineeArr = json.getJSONArray("linee")
                            val linee = (0 until lineeArr.length()).map { lineeArr.getString(it) }
                            val formatiArr = json.optJSONArray("formati")
                            val formati = if (formatiArr != null) (0 until formatiArr.length()).map { formatiArr.getString(it) } else null
                            val qrUrl    = if (json.isNull("qrUrl"))    null else json.optString("qrUrl").ifBlank    { null }
                            val qrBase64 = if (json.isNull("qrBase64")) null else json.optString("qrBase64").ifBlank { null }
                            val zoi      = if (json.isNull("zoi"))      null else json.optString("zoi").ifBlank      { null }
                            Log.i(TAG, "print-text: ${linee.size} vrstic, qrUrl=${qrUrl != null}, zoi=${zoi != null}")
                            val result = bridge.printText(linee, formati, qrUrl, qrBase64, zoi)
                            if (result.ok) {
                                sendJson(output, 200, """{"ok":true}""")
                            } else {
                                val err = (result.error ?: "Napaka").replace("\"", "'")
                                sendJson(output, 500, """{"ok":false,"error":"$err"}""")
                            }
                        } catch (e: Exception) {
                            val msg = (e.message ?: "JSON napaka").replace("\"", "'")
                            Log.e(TAG, "print-text JSON napaka: ${e.message}")
                            sendJson(output, 400, """{"ok":false,"error":"$msg"}""")
                        }
                    }

                    else -> sendJson(output, 404, """{"ok":false,"error":"Not found"}""")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Napaka zahteve: ${e.message}")
            }
        }
    }

    /** Preberi natanko content-length bajtov iz toka. */
    private fun readBody(input: java.io.InputStream, headers: Map<String, String>): ByteArray {
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length <= 0) return ByteArray(0)
        val buf = ByteArray(length)
        var total = 0
        while (total < length) {
            val n = input.read(buf, total, length - total)
            if (n < 0) break
            total += n
        }
        return if (total == length) buf else buf.copyOf(total)
    }

    private fun sendJson(output: OutputStream, status: Int, body: String) {
        val statusText = when (status) {
            200  -> "OK"
            400  -> "Bad Request"
            404  -> "Not Found"
            else -> "Internal Server Error"
        }
        val bodyBytes = body.toByteArray(Charsets.UTF_8)
        val sb = StringBuilder()
        sb.append("HTTP/1.1 $status $statusText\r\n")
        sb.append("Content-Type: application/json\r\n")
        sb.append("Content-Length: ${bodyBytes.size}\r\n")
        sb.append("Connection: close\r\n")
        CORS_HEADERS.forEach { sb.append("$it\r\n") }
        sb.append("\r\n")
        output.write(sb.toString().toByteArray(Charsets.UTF_8))
        output.write(bodyBytes)
        output.flush()
    }

    // ── Obvestilo ────────────────────────────────────────────────────────────

    private fun buildNotification(): Notification {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "NYX tiskalni most (NB80)", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Lokalni HTTP strežnik za tiskanje na NB80" }
            )
        }
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("NYX tiskalni most (NB80)")
            .setContentText("HTTP strežnik aktiven na localhost:$PORT")
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }
}
