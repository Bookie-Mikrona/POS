package si.bookie.fiscal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.security.interfaces.RSAPublicKey
import java.time.Instant
import java.time.OffsetDateTime
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Exact loopback transport for Bookie Fiscal Service v1.
 */
class BookieFiscalHttpServer(
    context: Context,
    private val allowedOrigin: String = "https://pos.bookie.si",
    private val printer: FiscalPrinter? = null,
) : Closeable {
    // Foreground services are direct-boot aware; fiscal state must therefore be
    // reachable after a device reboot before the first interactive unlock.
    private val app = context.applicationContext.createDeviceProtectedStorageContext()
    private val prefs = app.getSharedPreferences("bookie_fiscal_secure", Context.MODE_PRIVATE)
    private val ledger = FiscalLedger(app)
    private val trust = ProductionTrust.load(app)
    private val pool = Executors.newCachedThreadPool()
    @Volatile private var running = false
    private var socket: ServerSocket? = null

    fun start() {
        if (running) return
        check(!trust.productionReady || trust.keyId.isNotBlank()) { "Production trust anchor unavailable" }
        ensureDeviceKey()
        ensurePairing()
        running = true
        pool.execute {
            val server = ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), PORT))
            }
            socket = server
            while (running) {
                try { pool.execute { serve(server.accept()) } }
                catch (e: Exception) { if (running) android.util.Log.e(TAG, "Fiscal accept failed", e) }
            }
        }
    }

    override fun close() {
        running = false
        try { socket?.close() } catch (_: Exception) {}
        pool.shutdownNow()
    }

    /** Locally displayed, one-time code. Never returned by an HTTP capability. */
    fun pairingCode(): String {
        ensurePairing()
        return Vault.open(prefs.getString("pair_code", null)!!).toString(StandardCharsets.US_ASCII)
    }

    fun devicePublicKeyFingerprint(): String {
        val key = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getCertificate(DEVICE_KEY).publicKey
        return FiscalLedger.sha256(key.encoded)
    }

    /** Protects imported PKCS#12 bytes and metadata; validation occurs before this call. */
    fun storeProvisioning(pkcs12: ByteArray, password: CharArray, metadataCanonicalJson: ByteArray) {
        require(pkcs12.isNotEmpty() && password.isNotEmpty())
        val encodedPassword = StandardCharsets.UTF_8.encode(java.nio.CharBuffer.wrap(password))
        val passwordBytes = ByteArray(encodedPassword.remaining()).also(encodedPassword::get)
        try {
            val ok = prefs.edit()
                .putString("pkcs12", Vault.seal(pkcs12))
                .putString("pkcs12_password", Vault.seal(passwordBytes))
                .putString("provisioning_metadata", Vault.seal(metadataCanonicalJson))
                .commit()
            check(ok) { "Certificate persistence failed" }
        } finally {
            password.fill('\u0000')
            passwordBytes.fill(0)
            pkcs12.fill(0)
        }
    }

    /** Called only after a foreground Activity has completed device credential confirmation. */
    fun createLocalAdminUrl(): String {
        val ticket = ByteArray(32).also(SecureRandom()::nextBytes)
        val value = Base64.encodeToString(ticket, Base64.URL_SAFE or Base64.NO_WRAP)
        prefs.edit().putString("admin_ticket", FiscalLedger.sha256(ticket))
            .putLong("admin_ticket_expires", Instant.now().epochSecond + 120).commit()
        ticket.fill(0)
        return "http://127.0.0.1:$PORT/v1/admin/certificate?ticket=$value"
    }

    private fun adminCertificateGet(socket: Socket, r: Request) {
        val ticket = r.target.substringAfter("?ticket=", "")
        val supplied = try { Base64.decode(ticket, Base64.URL_SAFE or Base64.NO_WRAP) } catch (_: Exception) { ByteArray(0) }
        val valid = supplied.isNotEmpty() && Instant.now().epochSecond <= prefs.getLong("admin_ticket_expires", 0) &&
            constantTime(FiscalLedger.sha256(supplied), prefs.getString("admin_ticket", "") ?: "")
        supplied.fill(0)
        if (!valid) { respond(socket, 403, """{"error":"LOCAL_CONFIRMATION_REQUIRED"}""", null); return }
        val sessionBytes = ByteArray(32).also(SecureRandom()::nextBytes)
        val tokenBytes = ByteArray(32).also(SecureRandom()::nextBytes)
        val session = Base64.encodeToString(sessionBytes, Base64.URL_SAFE or Base64.NO_WRAP)
        val token = Base64.encodeToString(tokenBytes, Base64.URL_SAFE or Base64.NO_WRAP)
        prefs.edit().remove("admin_ticket").putLong("admin_ticket_expires", 0)
            .putString("admin_session", FiscalLedger.sha256(sessionBytes))
            .putString("admin_confirmation", FiscalLedger.sha256(tokenBytes))
            .putLong("admin_session_expires", Instant.now().epochSecond + 300).commit()
        sessionBytes.fill(0); tokenBytes.fill(0)
        val html = """<!doctype html><meta charset=utf-8><title>Bookie FURS certificate</title>
            <h1>Uvoz FURS digitalnega potrdila</h1>
            <form id=f enctype=multipart/form-data><input name=pkcs12 type=file accept=".p12,.pfx" required>
            <input name=password type=password autocomplete=off required><button>Uvozi</button></form><pre id=o></pre>
            <script>f.onsubmit=async e=>{e.preventDefault();let r=await fetch('/v1/admin/certificate',
            {method:'POST',headers:{'X-Bookie-Local-Confirmation':'$token'},body:new FormData(f)});
            o.textContent=await r.text();f.password.value='';}</script>"""
        respondRaw(socket, 200, html.toByteArray(StandardCharsets.UTF_8), "text/html; charset=utf-8",
            "Set-Cookie: BookieLocalAdmin=$session; HttpOnly; SameSite=Strict; Path=/v1/admin/certificate; Max-Age=300\r\n")
    }

    private fun adminCertificatePost(socket: Socket, r: Request) {
        val cookie = r.headers["cookie"]?.split(';')?.map { it.trim() }
            ?.firstOrNull { it.startsWith("BookieLocalAdmin=") }?.substringAfter('=') ?: ""
        val confirmation = r.headers["x-bookie-local-confirmation"] ?: ""
        val valid = Instant.now().epochSecond <= prefs.getLong("admin_session_expires", 0) &&
            constantTime(FiscalLedger.sha256(cookie.toByteArray(StandardCharsets.US_ASCII)),
                prefs.getString("admin_session", "") ?: "") &&
            constantTime(FiscalLedger.sha256(confirmation.toByteArray(StandardCharsets.US_ASCII)),
                prefs.getString("admin_confirmation", "") ?: "")
        // Consume before parsing/importing, including failed attempts.
        prefs.edit().remove("admin_session").remove("admin_confirmation").putLong("admin_session_expires", 0).commit()
        if (!valid) { respond(socket, 403, """{"error":"LOCAL_CONFIRMATION_INVALID"}""", null); return }
        var p12 = ByteArray(0)
        var password = CharArray(0)
        try {
            val contentType = r.headers["content-type"] ?: throw IllegalArgumentException("CONTENT_TYPE")
            val parts = parseMultipart(r.body, contentType)
            p12 = parts["pkcs12"] ?: throw IllegalArgumentException("PKCS12_REQUIRED")
            password = String(parts["password"] ?: throw IllegalArgumentException("PASSWORD_REQUIRED"),
                StandardCharsets.UTF_8).toCharArray()
            val ks = KeyStore.getInstance("PKCS12").apply { load(p12.inputStream(), password) }
            val alias = ks.aliases().toList().firstOrNull { ks.isKeyEntry(it) }
                ?: throw IllegalArgumentException("PRIVATE_KEY_REQUIRED")
            val cert = ks.getCertificate(alias) as? X509Certificate ?: throw IllegalArgumentException("X509_REQUIRED")
            cert.checkValidity()
            require(cert.keyUsage?.getOrNull(0) != false) { "CERTIFICATE_CANNOT_SIGN" }
            Signature.getInstance("SHA256withRSA").initSign(ks.getKey(alias, password) as PrivateKey)
            val fingerprint = "sha256:${FiscalLedger.sha256(cert.encoded)}"
            val expected = installedProvisioning()?.getJSONObject("furs")
                ?.getString("expectedCertificateFingerprint") ?: throw IllegalStateException("PROVISIONING_REQUIRED")
            require(constantTime(fingerprint, expected)) { "CERTIFICATE_FINGERPRINT_MISMATCH" }
            storeProvisioning(p12.copyOf(), password.copyOf(),
                JSONObject().put("fingerprint", fingerprint).put("validFrom", cert.notBefore.toInstant().toString())
                    .put("validUntil", cert.notAfter.toInstant().toString()).toString().toByteArray())
            respond(socket, 200, JSONObject().put("installed", true).put("fingerprint", fingerprint)
                .put("validFrom", cert.notBefore.toInstant()).put("validUntil", cert.notAfter.toInstant())
                .put("matchesProvisioningBundle", true).toString(), null)
        } catch (e: Exception) {
            respond(socket, if (e.message == "CERTIFICATE_FINGERPRINT_MISMATCH") 409 else 400,
                JSONObject().put("error", e.message ?: "CERTIFICATE_IMPORT_FAILED").toString(), null)
        } finally { p12.fill(0); password.fill('\u0000'); r.body.fill(0) }
    }

    private fun parseMultipart(body: ByteArray, contentType: String): Map<String, ByteArray> {
        val boundary = contentType.substringAfter("boundary=", "").trim().trim('"')
        require(boundary.length in 1..200)
        val marker = "--$boundary"
        val binary = body.toString(Charsets.ISO_8859_1)
        val out = mutableMapOf<String, ByteArray>()
        binary.split(marker).drop(1).forEach { raw ->
            if (raw.startsWith("--")) return@forEach
            val part = raw.removePrefix("\r\n")
            val split = part.indexOf("\r\n\r\n")
            if (split < 0) return@forEach
            val headers = part.substring(0, split)
            val name = Regex("""name="([^"]+)"""").find(headers)?.groupValues?.get(1) ?: return@forEach
            val data = part.substring(split + 4).removeSuffix("\r\n").toByteArray(Charsets.ISO_8859_1)
            require(name in setOf("pkcs12", "password") && name !in out)
            out[name] = data
        }
        return out
    }

    private fun serve(client: Socket) = client.use {
        it.soTimeout = 10_000
        val request = try { readRequest(it) } catch (e: TooLarge) {
            respond(it, 413, """{"error":"REQUEST_TOO_LARGE"}""", null); return
        } catch (_: Exception) {
            respond(it, 400, """{"error":"BAD_REQUEST"}""", null); return
        }
        val origin = request.headers["origin"]
        val localAdmin = request.target.substringBefore('?') == "/v1/admin/certificate"
        val serviceHostedOrigin = origin == null || origin == "null" || origin == "http://127.0.0.1:$PORT"
        if (origin != null && origin != allowedOrigin && !(localAdmin && serviceHostedOrigin)) {
            respond(it, 403, """{"error":"ORIGIN_FORBIDDEN"}""", null); return
        }
        if (request.method == "OPTIONS") {
            if (origin != allowedOrigin) respond(it, 403, """{"error":"ORIGIN_REQUIRED"}""", null)
            else respond(it, 204, "", origin)
            return
        }
        val public = request.method == "GET" && (request.target == "/v1/capabilities" ||
                request.target.startsWith("/v1/admin/certificate")) ||
            request.method == "POST" && (request.target == "/v1/pair" ||
                request.target == "/v1/provisioning/proof" || request.target == "/v1/admin/certificate")
        if (!public) {
            if (origin != allowedOrigin) {
                respond(it, 403, """{"error":"ORIGIN_REQUIRED"}""", null); return
            }
            val authError = authenticate(request)
            if (authError != null) {
                respond(it, if (authError == "REPLAY_DETECTED") 409 else 401,
                    """{"error":"$authError"}""", origin); return
            }
        }
        route(it, request, origin)
    }

    private fun route(socket: Socket, r: Request, origin: String?) {
        when {
            r.method == "GET" && r.target == "/v1/capabilities" -> {
                val provisioning = installedProvisioning()
                val printerProblem = printer?.isHealthy() != true
                val base = mutableListOf<String>()
                if (provisioning == null) base += "not_provisioned"
                if (!trust.productionReady) base += "release_trust_unavailable"
                if (provisioning != null) try {
                    val validity = provisioning.getJSONObject("validity")
                    val now = Instant.now()
                    if (now.isBefore(OffsetDateTime.parse(validity.getString("validFrom")).toInstant()) ||
                        now.isAfter(OffsetDateTime.parse(validity.getString("validUntil")).toInstant()))
                        base += "provisioning_expired_or_clock_invalid"
                    if (!provisioning.getJSONObject("sync").getString("httpsBaseUrl").startsWith("https://"))
                        base += "sync_target_invalid"
                } catch (_: Exception) { base += "provisioning_validity_invalid" }
                try { packagedGoldenAttestation() } catch (_: Exception) { base += "local_furs_generator_not_attested" }
                val certificate = try { loadFursKey() } catch (_: Exception) { null }
                if (certificate == null) base += "furs_certificate_not_installed"
                else try {
                    certificate.second.checkValidity()
                    val expected = provisioning?.getJSONObject("furs")?.getString("expectedCertificateFingerprint")
                    if (expected == null || expected != "sha256:${FiscalLedger.sha256(certificate.second.encoded)}")
                        base += "furs_certificate_fingerprint_mismatch"
                } catch (_: Exception) { base += "furs_certificate_invalid" }
                certificate?.third?.fill('\u0000')
                if (printerProblem) base += "printer_health_unavailable"
                if (provisioning?.optJSONObject("sync") == null) base += "sync_target_not_provisioned"
                if (app.filesDir.usableSpace < 4L * 1024 * 1024) base += "fiscal_storage_low"
                if (!ledger.verifyJournal()) base += "fiscal_storage_corrupt"
                val ready = base.isEmpty()
                val identity = provisioning?.getJSONObject("device")?.let { d ->
                    JSONObject().put("deviceId", d.getString("id")).put("unitId", d.getLong("enotaId"))
                        .put("premiseId", d.getLong("poslovniProstorId"))
                        .put("premiseLabel", d.getString("poslovniProstorOznaka"))
                        .put("bIdentifier", d.getString("bIdentifier"))
                }
                val response = JSONObject().put("service", "Bookie Fiscal Service").put("protocolVersion", "1.0")
                    .put("baseUrl", "http://127.0.0.1:17831/v1").put("ready", ready)
                    .put("readinessProblems", org.json.JSONArray(base)).put("envelopeFormat", "furs-v2")
                    .put("paymentMethods", org.json.JSONArray().put("cash")).put("maxBodyBytes", MAX_BODY)
                    .put("calendarPolicy", "SI-BUSINESS-DAY-V1")
                if (ready && identity != null) response.put("identity", identity)
                respond(socket, 200,
                    response.toString(), origin)
            }
            r.method == "POST" && r.target == "/v1/pair" -> pair(socket, r, origin)
            r.method == "POST" && r.target == "/v1/provisioning/proof" -> provisioningProof(socket, r, origin)
            r.method == "POST" && r.target == "/v1/provisioning/install" -> provisioningInstall(socket, r, origin)
            r.method == "GET" && r.target.startsWith("/v1/admin/certificate") -> adminCertificateGet(socket, r)
            r.method == "POST" && r.target == "/v1/admin/certificate" -> adminCertificatePost(socket, r)
            r.method == "POST" && r.target == "/v1/receipts/cash" -> issueCash(socket, r, origin)
            r.method == "POST" && r.target.matches(Regex("/v1/receipts/[0-9a-f-]+/reprint")) ->
                reprint(socket, r.target.substringAfter("/receipts/").substringBefore("/reprint"), origin)
            r.method == "GET" && r.target.startsWith("/v1/receipts/") ->
                getReceipt(socket, r.target.substringAfterLast('/'), origin)
            r.method == "GET" && r.target == "/v1/queue" -> {
                val items = org.json.JSONArray()
                ledger.sealedQueue().forEach { op ->
                    val printState = when (op.printStatus) {
                        "PRINTED" -> "printed"; "FAILED" -> "failed"; else -> "not_printed"
                    }
                    val projection = prefs.getString("bookie_projection_${op.idempotencyKey}", null)
                        ?.let { runCatching { JSONObject(it) }.getOrNull() }
                    val serverProjection = projection?.let { JSONObject(it.toString()) } ?: JSONObject()
                    if (!serverProjection.has("fursState")) serverProjection.put("fursState", JSONObject.NULL)
                    if (!serverProjection.has("eor")) serverProjection.put("eor", JSONObject.NULL)
                    if (!serverProjection.has("attemptCount")) serverProjection.put("attemptCount", 0)
                    if (!serverProjection.has("lastError")) serverProjection.put("lastError", JSONObject.NULL)
                    items.put(JSONObject()
                        .put("envelope", outerEnvelope(op.canonicalEnvelope!!))
                        .put("printState", projection?.optString("printState", printState) ?: printState)
                        .put("bookieDeliveryState", op.syncStatus.lowercase())
                        .put("serverFursProjection", serverProjection)
                        .put("submissionDeadlineAt", Instant.ofEpochMilli(op.deadlineAt).toString())
                    )
                }
                respond(socket, 200, JSONObject().put("items", items).toString(), origin)
            }
            r.method == "POST" && r.target == "/v1/sync" -> {
                pool.execute { syncOnce() }
                respond(socket, 202, """{"status":"accepted"}""", origin)
            }
            else -> respond(socket, 404, """{"error":"NOT_FOUND"}""", origin)
        }
    }

    private fun issueCash(socket: Socket, r: Request, origin: String?) {
        val provisioning = installedProvisioning() ?: run {
            respond(socket, 503, """{"error":"NOT_PRODUCTION_READY","detail":"Provisioning is not installed"}""", origin); return
        }
        val cert = loadFursKey() ?: run {
            respond(socket, 503, """{"error":"NOT_PRODUCTION_READY","detail":"FURS certificate is not installed"}""", origin); return
        }
        if (!trust.productionReady) {
            respond(socket, 503, """{"error":"NOT_PRODUCTION_READY","detail":"Debug builds cannot issue production receipts"}""", origin); return
        }
        if (printer?.isHealthy() != true || !ledger.verifyJournal()) {
            respond(socket, 503, """{"error":"NOT_PRODUCTION_READY","detail":"Printer or fiscal storage is unhealthy"}""", origin); return
        }
        try {
            val expected = expectedAuthority(provisioning)
            val request = DynamicFursEngine.parseAndVerifyCashIssueRequest(
                String(r.body, StandardCharsets.UTF_8), expected, Instant.now())
            val canonicalRequest = FiscalCrypto.canonicalJson(request.json)
            val operation = ledger.reserveOperation(request.operationId.toString(), canonicalRequest, System.currentTimeMillis())
            operation.canonicalEnvelope?.let {
                respond(socket, 200, outerEnvelope(it).toString(), origin); return
            }
            val deviceStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val deviceKey = deviceStore.getKey(DEVICE_KEY, null) as PrivateKey
            val devicePublicKeyPem = pem(deviceStore.getCertificate(DEVICE_KEY).publicKey.encoded)
            val taxNumber = cert.second.subjectX500Principal.name
                .let { Regex("(?:SERIALNUMBER=SI|OID\\.2\\.5\\.4\\.5=SI)([0-9]{8})").find(it)?.groupValues?.get(1) }
                ?: throw IllegalArgumentException("FURS certificate does not contain an 8 digit Slovenian tax number")
            val result = DynamicFursEngine.materializeAndSign(request, operation.ppbSequence,
                request.json.getString("legalTimestamp"), taxNumber, cert.first, cert.second, deviceKey,
                devicePublicKeyPem)
            val sealed = ledger.sealOperation(request.operationId.toString(), result.legalCoreCanonical)
            prefs.edit().putString("receipt_interruption_${request.operationId}",
                request.json.getString("interruptionStartedAt")).commit()
            val lines = legalLines(result)
            val printed = printer.printLegal(lines, result.zoi, result.zoi, false)
            ledger.markPrint(request.operationId.toString(), printed.isSuccess, printed.exceptionOrNull()?.message)
            respond(socket, 201, outerEnvelope(sealed.canonicalEnvelope).toString(), origin)
        } catch (_: FiscalLedger.IdempotencyMismatch) {
            respond(socket, 409, """{"error":"OPERATION_REPLAY_MISMATCH"}""", origin)
        } catch (e: Exception) {
            respond(socket, 400, JSONObject().put("error", "INVALID_CASH_ISSUE").put("detail", e.message).toString(), origin)
        } finally {
            cert.third.fill('\u0000')
        }
    }

    private fun getReceipt(socket: Socket, operationId: String, origin: String?) {
        val row = ledger.find(operationId)
        if (row?.canonicalEnvelope == null) respond(socket, 404, """{"error":"RECEIPT_NOT_FOUND"}""", origin)
        else respond(socket, 200, outerEnvelope(row.canonicalEnvelope).toString(), origin)
    }

    /** Shared POS boundary. The ledger remains authoritative for raw core bytes. */
    private fun outerEnvelope(coreBytes: ByteArray): JSONObject {
        val core = JSONObject(String(coreBytes, StandardCharsets.UTF_8))
        val plan = core.getJSONObject("finalizationPlan")
        val receipt = plan.getJSONObject("receipt")
        val authority = core.getJSONObject("authorityBundle")
        val payment = plan.getJSONObject("payment")
        val operationId = core.getString("operationId")
        return JSONObject()
            .put("operationId", operationId)
            .put("deviceId", authority.getJSONObject("scope").getString("deviceId"))
            .put("poslovniProstorId", authority.getJSONObject("scope").getLong("premiseId"))
            .put("poslovniProstorOznaka", receipt.getString("pp"))
            .put("bIdentifier", receipt.getString("b"))
            .put("sequence", receipt.getLong("ppBSequence"))
            .put("issuedAt", receipt.getString("issuedAt"))
            .put("interruptionStartedAt", prefs.getString("receipt_interruption_$operationId",
                receipt.getString("issuedAt")))
            .put("orderId", receipt.getLong("orderId"))
            .put("operatorReference", plan.getJSONObject("operator").opt("taxNumber") ?: JSONObject.NULL)
            .put("paymentReference", payment.opt("terminalReferenceReservationId") ?: JSONObject.NULL)
            .put("paymentMethod", "cash")
            .put("canonicalPayload", core)
            .put("payloadSha256", FiscalLedger.sha256(coreBytes))
            .put("deviceSignature", core.getString("deviceSignatureBase64"))
            .put("signingPublicKeyFingerprintSha256", core.getString("deviceKeyFingerprintSha256"))
    }

    private fun reprint(socket: Socket, operationId: String, origin: String?) {
        val row = ledger.find(operationId)
        val bytes = row?.canonicalEnvelope
        if (bytes == null) { respond(socket, 404, """{"error":"RECEIPT_NOT_FOUND"}""", origin); return }
        val core = JSONObject(String(bytes, StandardCharsets.UTF_8))
        val plan = core.getJSONObject("finalizationPlan")
        val legal = core.getJSONObject("legalInvoice")
        val lines = listOf("*** KOPIJA RAČUNA ***", plan.getJSONObject("print").getString("receiptNumber"),
            "ZOI: ${legal.getString("zoi")}")
        val result = printer?.printLegal(lines, legal.getString("zoi"), legal.getString("zoi"), true)
            ?: Result.failure(IllegalStateException("Printer unavailable"))
        ledger.markPrint(operationId, result.isSuccess, result.exceptionOrNull()?.message)
        respond(socket, if (result.isSuccess) 200 else 503,
            JSONObject().put("operationId", operationId).put("reprinted", result.isSuccess).toString(), origin)
    }

    private fun legalLines(result: DynamicFursEngine.Result): List<String> {
        val plan = result.finalizationPlan
        val print = plan.getJSONObject("print")
        val totals = plan.getJSONObject("totals")
        val lines = mutableListOf("RAČUN ${print.getString("receiptNumber")}",
            "Datum: ${print.getString("issuedAt")}")
        val sold = plan.getJSONArray("soldLines")
        for (i in 0 until sold.length()) lines += sold.getJSONObject(i).optString("name", sold.getJSONObject(i).toString())
        lines += "SKUPAJ: ${totals.get("gross")}"
        lines += "ZOI: ${result.zoi}"
        return lines
    }

    private fun installedProvisioning(): JSONObject? = prefs.getString("provisioning_bundle", null)
        ?.let { JSONObject(String(Vault.open(it), StandardCharsets.UTF_8)) }

    private fun expectedAuthority(p: JSONObject): OfflineAuthorityVerifier.Expected {
        val d = p.getJSONObject("device")
        return OfflineAuthorityVerifier.Expected(trust.publicKeyPem, trust.keyId,
            p.getJSONObject("authority").getInt("version"), p.getJSONObject("contract").getString("goldenAttestationSha256"),
            d.getString("companyId"), d.getLong("enotaId"), d.getString("id"),
            d.getLong("poslovniProstorId"), d.getString("bIdentifier"), d.getString("poslovniProstorOznaka"))
    }

    private fun loadFursKey(): Triple<PrivateKey, X509Certificate, CharArray>? {
        val p12 = prefs.getString("pkcs12", null)?.let(Vault::open) ?: return null
        val passBytes = prefs.getString("pkcs12_password", null)?.let(Vault::open) ?: return null
        val password = String(passBytes, StandardCharsets.UTF_8).toCharArray()
        try {
            val ks = KeyStore.getInstance("PKCS12").apply { load(p12.inputStream(), password) }
            val alias = ks.aliases().toList().firstOrNull { ks.isKeyEntry(it) } ?: return null
            return Triple(ks.getKey(alias, password) as PrivateKey, ks.getCertificate(alias) as X509Certificate, password)
        } finally { p12.fill(0); passBytes.fill(0) }
    }

    /**
     * One durable sync pass. UNKNOWN jobs use status GET exclusively; they are
     * never submitted again because an interrupted POST may have been accepted.
     */
    fun syncOnce(): Boolean {
        val p = installedProvisioning() ?: return false
        val sync = p.getJSONObject("sync")
        val base = sync.getString("httpsBaseUrl").removeSuffix("/")
        val deviceStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val key = deviceStore.getKey(DEVICE_KEY, null) as? PrivateKey ?: return false
        var allDone = true
        ledger.sealedQueue().filter {
            it.syncStatus !in setOf("CONFIRMED", "FAILED", "NEEDS_REVIEW")
        }.forEach { op ->
            if (System.currentTimeMillis() < prefs.getLong("sync_next_allowed_${op.idempotencyKey}", 0)) {
                allDone = false
                return@forEach
            }
            // Bookie ingest is the only device transport.  FURS SOAP, XMLDSig,
            // attempt IDs and FURS status polling are server-side concerns.
            val path = sync.getString("ingestPath")
            val method = "POST"
            val body = op.canonicalEnvelope!!
            val nonceBytes = ByteArray(24).also(SecureRandom()::nextBytes)
            val nonce = Base64.encodeToString(nonceBytes, Base64.URL_SAFE or Base64.NO_WRAP)
            nonceBytes.fill(0)
            val timestamp = DeviceSyncAuth.timestamp(Instant.now())
            val bodyHash = FiscalLedger.sha256(body)
            val input = DeviceSyncAuth.signatureInput(method, path, timestamp, nonce, bodyHash)
            val signature = Signature.getInstance("SHA256withRSA").run {
                initSign(key); update(input.toByteArray(StandardCharsets.UTF_8))
                Base64.encodeToString(sign(), Base64.NO_WRAP)
            }
            // Persist nonce/attempt before touching the network.
            val attemptKey = "sync_post_attempt_${op.idempotencyKey}"
            prefs.edit().putString("sync_nonce_${op.idempotencyKey}", nonce)
                .putInt(attemptKey, prefs.getInt(attemptKey, 0) + 1).commit()
            try {
                val c = URL(base + path).openConnection() as HttpURLConnection
                c.requestMethod = method
                c.instanceFollowRedirects = false
                c.connectTimeout = 15_000; c.readTimeout = 20_000
                c.setRequestProperty("X-Bookie-Device-Id", p.getJSONObject("device").getString("id"))
                c.setRequestProperty("X-Bookie-Timestamp", timestamp)
                c.setRequestProperty("X-Bookie-Nonce", nonce)
                c.setRequestProperty("X-Bookie-Body-SHA256", bodyHash)
                c.setRequestProperty("X-Bookie-Signature", signature)
                c.doOutput = true; c.setFixedLengthStreamingMode(body.size)
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body) }
                val code = c.responseCode
                val response = try {
                    (if (code in 200..299) c.inputStream else c.errorStream)
                        ?.bufferedReader()?.use { it.readText() }.orEmpty()
                } catch (_: Exception) { "" }
                if (code in 200..299) {
                    // A Bookie acceptance durably owns FURS submission; delivery
                    // of this immutable LegalInvoiceCore is complete.
                    ledger.markSync(op.idempotencyKey, FiscalLedger.SyncState.CONFIRMED)
                    if (response.isNotBlank()) {
                        val serverProjection = JSONObject(response)
                        if (!serverProjection.has("attemptCount")) serverProjection.put("attemptCount", 0)
                        if (!serverProjection.has("lastError")) serverProjection.put("lastError", JSONObject.NULL)
                        if (!serverProjection.has("eor")) serverProjection.put("eor", JSONObject.NULL)
                        if (!serverProjection.has("fursState")) serverProjection.put("fursState", JSONObject.NULL)
                        prefs.edit().putString("bookie_projection_${op.idempotencyKey}",
                            serverProjection.toString()).commit()
                    }
                } else {
                    val decision = SyncSemantics.decide(false, code)
                    ledger.markSync(op.idempotencyKey, FiscalLedger.SyncState.valueOf(decision.state.name),
                        "HTTP $code")
                    val attempts = prefs.getInt(attemptKey, 1)
                    val edit = prefs.edit()
                    if (decision.state == SyncSemantics.State.UNKNOWN || decision.retryPost) {
                        edit.putLong("sync_next_allowed_${op.idempotencyKey}",
                            System.currentTimeMillis() + SyncSemantics.boundedBackoffMillis(attempts))
                    }
                    edit.commit()
                    if (decision.state != SyncSemantics.State.NEEDS_REVIEW) allDone = false
                }
            } catch (e: Exception) {
                val attempts = prefs.getInt(attemptKey, 1)
                ledger.markSync(op.idempotencyKey, FiscalLedger.SyncState.UNKNOWN, e.javaClass.simpleName)
                prefs.edit().putLong("sync_next_allowed_${op.idempotencyKey}",
                    System.currentTimeMillis() + SyncSemantics.boundedBackoffMillis(attempts)).commit()
                allDone = false
            } finally { body.fill(0) }
        }
        return allDone
    }

    fun overdueSyncCount(): Int = ledger.overdueUnconfirmed()

    private fun provisioningInstall(socket: Socket, r: Request, origin: String?) {
        val bundle = try { JSONObject(String(r.body, StandardCharsets.UTF_8)) } catch (_: Exception) {
            respond(socket, 400, """{"error":"INVALID_PROVISIONING"}""", origin); return
        }
        try {
            val minimum = prefs.getInt("provisioning_version", 0)
            val expectedAttestation = packagedGoldenAttestation()
            val verified = ProvisioningVerifier.verify(
                bundle, trust, devicePublicKeyFingerprint(), minimum, expectedAttestation
            )
            val oldId = prefs.getString("provisioning_bundle_id", null)
            if (verified.version == minimum && oldId != null && oldId != verified.bundleId)
                throw IllegalArgumentException("PROVISIONING_VERSION_CONFLICT")
            val ok = prefs.edit()
                .putString("provisioning_bundle", Vault.seal(verified.canonical))
                .putString("provisioning_bundle_id", verified.bundleId)
                .putInt("provisioning_version", verified.version)
                .commit()
            check(ok) { "PROVISIONING_PERSISTENCE" }
            respond(socket, 200,
                JSONObject().put("installed", true).put("bundleId", verified.bundleId)
                    .put("version", verified.version).toString(), origin)
        } catch (e: Exception) {
            respond(socket, 409, JSONObject().put("error", e.message ?: "PROVISIONING_REJECTED").toString(), origin)
        }
    }

    private fun packagedGoldenAttestation(): String {
        return RuntimeGoldenAttestation.verify(app)
    }

    private fun provisioningProof(socket: Socket, r: Request, origin: String?) {
        val json = try { JSONObject(String(r.body, StandardCharsets.UTF_8)) } catch (_: Exception) { null }
        if (json == null || json.length() != 2 ||
            json.keys().asSequence().toSet() != setOf("challengeId", "challenge")) {
            respond(socket, 400, """{"error":"INVALID_PROVISIONING_CHALLENGE"}""", origin)
            return
        }
        val challengeId = json.optString("challengeId")
        val challenge = json.optString("challenge")
        try {
            java.util.UUID.fromString(challengeId)
            require(challenge.isNotEmpty())
        } catch (_: Exception) {
            respond(socket, 400, """{"error":"INVALID_PROVISIONING_CHALLENGE"}""", origin)
            return
        }
        ensureDeviceKey()
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val certificate = store.getCertificate(DEVICE_KEY)
        val publicKeyPem = pem(certificate.publicKey.encoded)
        // The normative fingerprint is over normalized SPKI PEM bytes, including
        // the final LF emitted by [pem], rather than over the DER alone.
        val fingerprint = FiscalLedger.sha256(certificate.publicKey.encoded)
        val input = FiscalCrypto.registrationProofInput(challengeId, challenge, publicKeyPem)
        val privateKey = store.getKey(DEVICE_KEY, null) as java.security.PrivateKey
        val signature = Signature.getInstance("SHA256withRSA").run {
            initSign(privateKey)
            update(input.toByteArray(StandardCharsets.UTF_8))
            sign()
        }
        val response = JSONObject()
            .put("challengeId", challengeId)
            .put("publicKeyPem", publicKeyPem)
            .put("proofSignatureBase64", Base64.encodeToString(signature, Base64.NO_WRAP))
            .put("keyFingerprintSha256", fingerprint)
        respond(socket, 200, response.toString(), origin)
    }

    private fun pair(socket: Socket, r: Request, origin: String?) {
        if (origin != allowedOrigin) {
            respond(socket, 403, """{"error":"ORIGIN_REQUIRED"}""", null); return
        }
        val now = Instant.now().epochSecond
        val blockedUntil = prefs.getLong("pair_blocked_until", 0)
        if (now < blockedUntil) {
            respond(socket, 429, """{"error":"PAIR_THROTTLED"}""", origin); return
        }
        val json = try { JSONObject(String(r.body, StandardCharsets.UTF_8)) } catch (_: Exception) { null }
        if (json == null || json.length() != 2 || !json.has("code") || !json.has("clientName") ||
            json.optString("clientName").length !in 1..100) {
            pairFailure(now); respond(socket, 401, """{"error":"PAIR_CODE_INVALID"}""", origin); return
        }
        val supplied = json.optString("code")
        val expected = pairingCode()
        val expires = prefs.getLong("pair_expires", 0)
        if (now > expires || !MessageDigest.isEqual(
                supplied.toByteArray(StandardCharsets.US_ASCII), expected.toByteArray(StandardCharsets.US_ASCII))) {
            pairFailure(now); respond(socket, 401, """{"error":"PAIR_CODE_INVALID"}""", origin); return
        }
        val secret = Vault.open(prefs.getString("pair_secret", null)!!)
        prefs.edit().remove("pair_code").putLong("pair_expires", 0).putInt("pair_failures", 0).apply()
        val encoded = Base64.encodeToString(secret, Base64.URL_SAFE or Base64.NO_WRAP)
        respond(socket, 200, """{"pairingSecret":"$encoded","contract":"v1"}""", origin)
    }

    private fun pairFailure(now: Long) {
        val failures = prefs.getInt("pair_failures", 0) + 1
        prefs.edit().putInt("pair_failures", failures)
            .putLong("pair_blocked_until", if (failures >= 5) now + 60 else 0).apply()
    }

    private fun authenticate(r: Request): String? {
        val pairing = r.headers["x-bookie-pairing"] ?: return "AUTH_REQUIRED"
        val timestamp = r.headers["x-bookie-timestamp"] ?: return "AUTH_REQUIRED"
        val nonce = r.headers["x-bookie-nonce"] ?: return "AUTH_REQUIRED"
        val signature = r.headers["x-bookie-signature"] ?: return "AUTH_REQUIRED"
        val stamp = timestamp.toLongOrNull() ?: return "AUTH_INVALID"
        if (kotlin.math.abs(Instant.now().epochSecond - stamp) > 300) return "AUTH_INVALID"
        val nonceBytes = try { Base64.decode(nonce, Base64.URL_SAFE or Base64.NO_WRAP) } catch (_: Exception) { return "AUTH_INVALID" }
        if (nonceBytes.size < 16) return "AUTH_INVALID"
        val secret = prefs.getString("pair_secret", null)?.let(Vault::open) ?: return "AUTH_INVALID"
        val expectedPairing = Base64.encodeToString(secret, Base64.URL_SAFE or Base64.NO_WRAP)
        if (!constantTime(pairing, expectedPairing)) return "AUTH_INVALID"
        val input = "${r.method}\n${r.target}\n$timestamp\n$nonce\n${FiscalLedger.sha256(r.body)}"
        val mac = Mac.getInstance("HmacSHA256").apply {
            init(SecretKeySpec(secret, "HmacSHA256"))
        }.doFinal(input.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
        if (!constantTime(signature, mac)) return "AUTH_INVALID"
        synchronized(prefs) {
            val cutoff = Instant.now().epochSecond - 300
            val expired = prefs.all.filter { it.key.startsWith("nonce_") && (it.value as? Long ?: 0) < cutoff }.keys
            if (expired.isNotEmpty()) prefs.edit().also { edit -> expired.forEach(edit::remove) }.commit()
            val key = "nonce_" + FiscalLedger.sha256(nonce.toByteArray(StandardCharsets.US_ASCII))
            if (prefs.getLong(key, 0) >= cutoff) return "REPLAY_DETECTED"
            prefs.edit().putLong(key, Instant.now().epochSecond).commit()
        }
        return null
    }

    private fun readRequest(socket: Socket): Request {
        val input = socket.getInputStream()
        val headers = ByteArrayOutputStream()
        var state = 0
        while (state < 4) {
            val b = input.read()
            if (b < 0) throw IllegalArgumentException()
            headers.write(b)
            if (headers.size() > MAX_HEADERS) throw TooLarge()
            state = when {
                state == 0 && b == 13 -> 1
                state == 1 && b == 10 -> 2
                state == 2 && b == 13 -> 3
                state == 3 && b == 10 -> 4
                else -> 0
            }
        }
        val lines = headers.toString("US-ASCII").split("\r\n")
        val first = lines.first().split(" ")
        if (first.size != 3 || first[2] != "HTTP/1.1") throw IllegalArgumentException()
        val map = mutableMapOf<String, String>()
        lines.drop(1).filter { it.isNotEmpty() }.forEach {
            val pos = it.indexOf(':'); if (pos <= 0) throw IllegalArgumentException()
            val name = it.substring(0, pos).lowercase()
            if (map.containsKey(name)) throw IllegalArgumentException("Duplicate header")
            map[name] = it.substring(pos + 1).trim()
        }
        if (map.containsKey("transfer-encoding")) throw IllegalArgumentException("Transfer encoding is forbidden")
        val length = map["content-length"]?.toIntOrNull() ?: 0
        val limit = if (first[1].substringBefore('?') == "/v1/admin/certificate") ADMIN_MAX_BODY else MAX_BODY
        if (length !in 0..limit) throw TooLarge()
        val body = ByteArray(length)
        var offset = 0
        while (offset < length) {
            val read = input.read(body, offset, length - offset)
            if (read < 0) throw IllegalArgumentException()
            offset += read
        }
        return Request(first[0], first[1], map, body)
    }

    private fun respond(socket: Socket, code: Int, json: String, origin: String?) {
        respondRaw(socket, code, json.toByteArray(StandardCharsets.UTF_8), "application/json", cors(origin))
    }

    private fun cors(origin: String?): String = if (origin == allowedOrigin)
        "Access-Control-Allow-Origin: $allowedOrigin\r\nVary: Origin\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type, X-Bookie-Pairing, X-Bookie-Timestamp, X-Bookie-Nonce, X-Bookie-Signature\r\n"
        else ""

    private fun respondRaw(socket: Socket, code: Int, body: ByteArray, contentType: String, extraHeaders: String = "") {
        val phrase = mapOf(200 to "OK", 201 to "Created", 202 to "Accepted", 204 to "No Content",
            400 to "Bad Request", 401 to "Unauthorized", 403 to "Forbidden", 404 to "Not Found",
            409 to "Conflict", 413 to "Payload Too Large", 429 to "Too Many Requests", 503 to "Service Unavailable")[code] ?: "Error"
        val h = StringBuilder("HTTP/1.1 $code $phrase\r\nContent-Type: $contentType\r\nContent-Length: ${body.size}\r\nConnection: close\r\n")
        h.append(extraHeaders)
        socket.getOutputStream().apply { write(h.append("\r\n").toString().toByteArray(StandardCharsets.US_ASCII)); write(body); flush() }
    }

    private fun ensurePairing() {
        if (!prefs.contains("pair_secret"))
            prefs.edit().putString("pair_secret", Vault.seal(ByteArray(32).also(SecureRandom()::nextBytes))).apply()
        if (!prefs.contains("pair_code") || prefs.getLong("pair_expires", 0) < Instant.now().epochSecond) {
            val code = "%06d".format(SecureRandom().nextInt(1_000_000))
            prefs.edit().putString("pair_code", Vault.seal(code.toByteArray(StandardCharsets.US_ASCII)))
                .putLong("pair_expires", Instant.now().epochSecond + 600).apply()
        }
    }

    private fun ensureDeviceKey() {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getCertificate(DEVICE_KEY)?.publicKey as? RSAPublicKey
        if (existing != null && existing.modulus.bitLength() != DEVICE_KEY_BITS) {
            // A pre-production 2048-bit key must never survive the protocol's
            // production 3072-bit requirement under the same identity.
            store.deleteEntry(DEVICE_KEY)
        }
        if (!store.containsAlias(DEVICE_KEY)) {
            KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply {
                initialize(KeyGenParameterSpec.Builder(DEVICE_KEY, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setDigests(KeyProperties.DIGEST_SHA256).setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                    .setKeySize(DEVICE_KEY_BITS).build())
            }.generateKeyPair()
        }
    }

    private fun pem(der: ByteArray): String {
        val b64 = Base64.encodeToString(der, Base64.NO_WRAP)
        return "-----BEGIN PUBLIC KEY-----\n" + b64.chunked(64).joinToString("\n") + "\n-----END PUBLIC KEY-----\n"
    }

    private fun constantTime(a: String, b: String) = MessageDigest.isEqual(
        a.toByteArray(StandardCharsets.US_ASCII), b.toByteArray(StandardCharsets.US_ASCII))

    private data class Request(val method: String, val target: String, val headers: Map<String, String>, val body: ByteArray)
    private class TooLarge : RuntimeException()

    private object Vault {
        private const val ALIAS = "bookie.fiscal.vault.v1"
        fun seal(bytes: ByteArray): String {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            return Base64.encodeToString(cipher.iv + cipher.doFinal(bytes), Base64.NO_WRAP)
        }
        fun open(value: String): ByteArray {
            val bytes = Base64.decode(value, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            }
            return cipher.doFinal(bytes, 12, bytes.size - 12)
        }
        private fun key(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            return javax.crypto.KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
        }
    }

    companion object {
        const val PORT = 17831
        const val MAX_BODY = 65_536
        const val ADMIN_MAX_BODY = 10 * 1024 * 1024
        private const val MAX_HEADERS = 16_384
        private const val TAG = "BookieFiscalService"
        private const val DEVICE_KEY = "bookie.fiscal.device.rsa.v1"
        private const val DEVICE_KEY_BITS = 3072
    }
}