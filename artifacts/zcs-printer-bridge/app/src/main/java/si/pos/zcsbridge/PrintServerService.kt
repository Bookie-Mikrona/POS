package si.pos.zcsbridge

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
 * Posluša na localhost:[PORT].
 *
 * GET  /status      — JSON stanje tiskalnika
 * GET  /diagnostics — diagnostika: device datoteke, ZCS paketi
 * POST /print       — telo = surovi ESC/POS bajti
 * POST /print-text  — telo = UTF-8 JSON { linee, qrUrl, qrBase64 }
 * OPTIONS *         — CORS preflight
 *
 * Telo se bere kot surovi bajti (ne CharArray) da pravilno obravnavamo
 * UTF-8 večbajtne znake (č, š, ž) pri Content-Length izračunu.
 */
class PrintServerService : Service() {

    companion object {
        const val PORT = 8090
        private const val TAG = "PrintServerService"
        private const val CHANNEL_ID = "zcs_print_bridge"
        private const val NOTIF_ID = 1

        private val CORS_HEADERS = listOf(
            "Access-Control-Allow-Origin: *",
            "Access-Control-Allow-Methods: GET, POST, OPTIONS",
            "Access-Control-Allow-Headers: Content-Type, X-Requested-With, Access-Control-Request-Private-Network",
            "Access-Control-Allow-Private-Network: true",
        )
    }

    private lateinit var bridge: ZcsPrinterBridge
    private val executor = Executors.newCachedThreadPool()

    @Volatile private var running = false
    private var serverSocket: ServerSocket? = null

    override fun onCreate() {
        super.onCreate()
        bridge = ZcsPrinterBridge(applicationContext)

        // startForeground MORA biti klican v 5 sekundah od startForegroundService().
        // bridge.connect() skenira APK-je in lahko traja dlje → kličemo ga ASINHRONO
        // šele ko je notifikacija že prikazana in Android servis ne more več ubiti.
        startForeground(NOTIF_ID, buildNotification())
        startHttpServer()

        // Inicializacija tiskalnika v ozadju — ne blokira 5-sekundnega okna
        executor.submit {
            bridge.connect()
            updateNotification(
                if (bridge.isReady()) "Tiskalnik pripravljen ✓"
                else "Servis aktiven — tiskalnik se inicializira"
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        running = false
        serverSocket?.close()
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
                // reuseAddress = true: prepreči "Address already in use" ob restartu servisa
                // (stara instanca morda ni pravočasno sprostila vrat)
                val srv = java.net.ServerSocket().apply {
                    reuseAddress = true
                    bind(java.net.InetSocketAddress(PORT))
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
                .setContentTitle("ZCS tiskalni most")
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
     * S tem se izognemo napaki, kjer CharArray(contentLengthBytes) čaka
     * preveč znakov za UTF-8 večbajtne znake (č, š, ž).
     */
    private fun handleConnection(socket: Socket) {
        socket.use {
            try {
                val input = it.inputStream
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
                val path = requestParts[1]

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
                        val json = """{"ok":$isReady,"status":"${bridge.statusText()}","port":$PORT}"""
                        sendJson(output, 200, json)
                    }

                    method == "GET" && path == "/diagnostics" -> {
                        // Preveri device datoteke
                        val devFiles = listOf(
                            "/dev/stprinter", "/dev/thermal_printer", "/dev/printer",
                            "/dev/prn", "/dev/ttyS1", "/dev/ttyS2",
                            "/dev/bt_printer", "/dev/zcs_printer"
                        )
                        val existing = devFiles.filter { java.io.File(it).exists() }
                        val writable = existing.filter { path ->
                            try {
                                java.io.FileOutputStream(path, true).use {}
                                true
                            } catch (_: Exception) { false }
                        }
                        // ZCS paketi
                        val zcsPkgs = bridge.getInstalledZcsPackages()
                        // Sistemske lib datoteke
                        val sysLibs = try {
                            java.io.File("/system/lib64").listFiles()
                                ?.filter { it.name.contains("zcs", true) || it.name.contains("smart", true) }
                                ?.map { it.name } ?: emptyList()
                        } catch (_: Exception) { emptyList() }

                        val existingJson = existing.joinToString(",") { "\"$it\"" }
                        val writableJson = writable.joinToString(",") { "\"$it\"" }
                        val pkgsJson = zcsPkgs.joinToString(",") { "\"$it\"" }
                        val libsJson = sysLibs.joinToString(",") { "\"$it\"" }

                        sendJson(output, 200, """{"devFiles":[$existingJson],"writableDevFiles":[$writableJson],"zcsPackages":[$pkgsJson],"sysLibs":[$libsJson],"bridgeReady":${bridge.isReady()},"status":"${bridge.statusText()}"}""")
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
                        // UTF-8 JSON: { linee: string[], qrUrl: string|null, qrBase64: string|null }
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
                            val qrUrl = if (json.isNull("qrUrl")) null else json.optString("qrUrl").ifBlank { null }
                            val qrBase64 = if (json.isNull("qrBase64")) null else json.optString("qrBase64").ifBlank { null }
                            Log.i(TAG, "print-text: ${linee.size} vrstic, qrBase64=${qrBase64 != null}")
                            val result = bridge.printText(linee, formati, qrUrl, qrBase64)
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
            200 -> "OK"
            400 -> "Bad Request"
            404 -> "Not Found"
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
                NotificationChannel(CHANNEL_ID, "ZCS tiskalni most", NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "Lokalni HTTP strežnik za tiskanje" }
            )
        }
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("ZCS tiskalni most")
            .setContentText("HTTP strežnik aktiven na localhost:$PORT")
            .setSmallIcon(android.R.drawable.ic_menu_send)
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }
}
