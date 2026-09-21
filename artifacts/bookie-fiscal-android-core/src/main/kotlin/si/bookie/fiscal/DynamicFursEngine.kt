package si.bookie.fiscal

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.cert.X509Certificate
import java.time.OffsetDateTime
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.Instant
import java.util.Base64
import java.util.UUID

/**
 * Pure, deterministic implementation of the offline FURS v2 legal-core
 * contract. It deliberately performs no persistence, clock, random or network
 * access. Sequence allocation and the legal Ljubljana timestamp are inputs.
 */
object DynamicFursEngine {
    private val LJUBLJANA = ZoneId.of("Europe/Ljubljana")
    private val LOCAL_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss")
    private val ZOI_TIME = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss")
    private const val DS = "http://www.w3.org/2000/09/xmldsig#"
    private const val C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315"
    private const val RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
    private const val SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256"
    private const val ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature"

    data class OfflineAuthorityBundle internal constructor(val json: JSONObject)
    data class FinalizationPlanTemplate internal constructor(val json: JSONObject)
    data class CashIssueRequest internal constructor(
        val json: JSONObject,
        val operationId: UUID,
        val authority: OfflineAuthorityBundle,
        val template: FinalizationPlanTemplate,
    )

    data class DerivedIds(
        val localReceiptId: UUID,
        val issueReservationId: UUID,
        val snapshotId: UUID,
        val artifactId: UUID,
    )

    data class Result(
        val ids: DerivedIds,
        val finalizationPlan: JSONObject,
        val finalizationPlanCanonical: ByteArray,
        val finalizationPlanSha256: String,
        val legalInvoice: JSONObject,
        val zoiInput: ByteArray,
        val zoiSignature: ByteArray,
        val zoi: String,
        val certificateFingerprint: String,
        val deviceSignatureMessage: ByteArray,
        val deviceSignature: ByteArray,
        val legalCore: JSONObject,
        val legalCoreCanonical: ByteArray,
    )

    fun parseOfflineAuthorityBundle(value: String): OfflineAuthorityBundle =
        parseOfflineAuthorityBundle(parseObject(value, "OfflineAuthorityBundle"))

    fun parseOfflineAuthorityBundle(value: JSONObject): OfflineAuthorityBundle {
        val j = clone(value)
        exactKeys(j, setOf("schema", "bundleId", "server", "scope", "contract", "validity", "operator",
            "catalog", "modifiers", "policies", "authority", "bundleSha256", "signatureBase64"), "authority bundle")
        require(j.reqString("schema") == "bookie-offline-authority-v1") { "AUTHORITY_SCHEMA" }
        uuid(j.reqString("bundleId"), "bundleId")
        val server = j.reqObject("server")
        exactKeys(server, setOf("companyId", "enotaId"), "authority.server")
        uuid(server.reqString("companyId"), "companyId")
        require(server.reqPositiveLong("enotaId") > 0)
        val scope = j.reqObject("scope")
        exactKeys(scope, setOf("deviceId", "premiseId", "bIdentifier"), "authority.scope")
        uuid(scope.reqString("deviceId"), "deviceId")
        scope.reqPositiveLong("premiseId")
        identifier(scope.reqString("bIdentifier"), "bIdentifier")
        val contract = j.reqObject("contract")
        exactKeys(contract, setOf("version", "goldenAttestationSha256", "authorityVersion"), "authority.contract")
        require(contract.reqString("version") == "furs-v2")
        hex64(contract.reqString("goldenAttestationSha256"), "goldenAttestationSha256")
        contract.reqPositiveLong("authorityVersion")
        val validity = j.reqObject("validity")
        exactKeys(validity, setOf("validFrom", "validUntil", "outageSubmissionBusinessDays"), "authority.validity")
        val from = legalOffset(validity.reqString("validFrom"), "validFrom")
        val until = legalOffset(validity.reqString("validUntil"), "validUntil")
        require(from.toInstant().isBefore(until.toInstant())) { "Invalid authority validity interval" }
        require(validity.reqLong("outageSubmissionBusinessDays") == 2L) { "AUTHORITY_DEADLINE_POLICY" }
        validateOperator(j.reqObject("operator"), "authority.operator", allowActor = false)
        require(j.reqArray("catalog").length() > 0) { "Authority catalog is empty" }
        require(j.reqArray("modifiers").length() >= 0)
        j.reqObject("policies")
        val authority = j.reqObject("authority")
        exactKeys(authority, setOf("keyId", "algorithm", "publicKeyPem"), "authority.authority")
        require(authority.reqString("keyId").isNotBlank())
        require(authority.reqString("algorithm") == "RSA-SHA256")
        require(authority.reqString("publicKeyPem").startsWith("-----BEGIN PUBLIC KEY-----\n"))
        hex64(j.reqString("bundleSha256"), "bundleSha256")
        decodeBase64(j.reqString("signatureBase64"), "signatureBase64")
        return OfflineAuthorityBundle(j)
    }

    /** Parses first, then applies the provisioned trust boundary fail-closed. */
    fun parseAndVerifyOfflineAuthorityBundle(
        value: String,
        expected: OfflineAuthorityVerifier.Expected,
        now: Instant,
    ): OfflineAuthorityBundle = parseOfflineAuthorityBundle(value).also {
        OfflineAuthorityVerifier.verify(it.json, expected, now)
    }

    fun parseFinalizationPlanTemplate(value: String): FinalizationPlanTemplate =
        parseFinalizationPlanTemplate(parseObject(value, "FinalizationPlanTemplate"))

    fun parseFinalizationPlanTemplate(value: JSONObject): FinalizationPlanTemplate {
        val j = clone(value)
        val required = setOf("version", "source", "sourceOperationId", "soldLines", "normativeSnapshot", "totals",
            "payment", "operator", "closure", "tip", "stockMovements", "kds", "accounting", "print", "receiptContext")
        exactKeys(j, required, "finalizationPlanTemplate")
        require(j.reqLong("version") == 2L && j.reqString("source") == "offline")
        uuid(j.reqString("sourceOperationId"), "sourceOperationId")
        val sold = j.reqArray("soldLines")
        require(sold.length() in 1..250) { "Invalid soldLines count" }
        for (i in 0 until sold.length()) validateFiniteTree(sold.get(i), "soldLines[$i]")
        validateFiniteTree(j, "finalizationPlanTemplate")
        val totals = j.reqObject("totals")
        require(money(totals, "gross") == money(j.reqObject("payment"), "cash") +
            money(j.reqObject("payment"), "card") + money(j.reqObject("payment"), "voucher") +
            money(j.reqObject("payment"), "pizzaVoucher") + money(j.reqObject("payment"), "nonCash")) {
            "Payment total does not equal receipt gross"
        }
        validateOperator(j.reqObject("operator"), "template.operator", allowActor = true)
        legalOffset(j.reqObject("print").reqString("issuedAt"), "print.issuedAt")
        return FinalizationPlanTemplate(j)
    }

    fun parseCashIssueRequest(value: String): CashIssueRequest =
        parseCashIssueRequest(parseObject(value, "CashIssueRequest"))

    fun parseAndVerifyCashIssueRequest(
        value: String,
        expected: OfflineAuthorityVerifier.Expected,
        now: Instant,
    ): CashIssueRequest = parseCashIssueRequest(value).also {
        OfflineAuthorityVerifier.verify(it.authority.json, expected, now)
        val issued = legalOffset(it.json.reqString("legalTimestamp"), "legalTimestamp").toInstant()
        require(kotlin.math.abs(issued.epochSecond - now.epochSecond) <= 300) {
            "LEGAL_TIMESTAMP_OUTSIDE_DEVICE_CLOCK_TOLERANCE"
        }
        expected.premiseLabel?.let { provisionedLabel ->
            val seed = it.template.json.reqObject("print").reqString("receiptNumber")
            require(premiseFromReceiptSeed(seed, expected.bIdentifier) == provisionedLabel) {
                "BUSINESS_PREMISE_LABEL_MISMATCH"
            }
        }
    }

    fun parseCashIssueRequest(value: JSONObject): CashIssueRequest {
        val j = clone(value)
        exactKeys(j, setOf("operationId", "authorityBundle", "orderEventSnapshot", "finalizationPlanTemplate",
            "legalTimestamp", "interruptionStartedAt"), "cashIssueRequest")
        val operation = uuid(j.reqString("operationId"), "operationId")
        val authority = parseOfflineAuthorityBundle(j.reqObject("authorityBundle"))
        val template = parseFinalizationPlanTemplate(j.reqObject("finalizationPlanTemplate"))
        require(template.json.reqString("sourceOperationId") == operation.toString()) { "Operation ID mismatch" }
        val order = j.reqObject("orderEventSnapshot")
        exactKeys(order, setOf("orderId", "orderVersion", "eventId", "capturedAt", "lineIds"), "orderEventSnapshot")
        order.reqPositiveLong("orderId")
        val orderVersion = order.get("orderVersion")
        require((orderVersion is Number && orderVersion.toLong() > 0 &&
            orderVersion.toDouble() == orderVersion.toLong().toDouble()) ||
            (orderVersion is String && orderVersion.isNotBlank())) { "Invalid orderVersion" }
        if (!order.isNull("eventId")) order.reqPositiveLong("eventId")
        legalOffset(order.reqString("capturedAt"), "capturedAt")
        require(order.reqArray("lineIds").length() > 0)
        val ctx = template.json.reqObject("receiptContext")
        require(ctx.reqLong("orderId") == order.reqLong("orderId")) { "Order snapshot mismatch" }
        val scope = authority.json.reqObject("scope")
        require(ctx.reqString("companyId") == authority.json.reqObject("server").reqString("companyId"))
        require(ctx.reqLong("enotaId") == authority.json.reqObject("server").reqLong("enotaId"))
        require(template.json.reqObject("operator").reqLong("waiterId") == authority.json.reqObject("operator").reqLong("waiterId"))
        require(scope.reqString("bIdentifier").isNotBlank())
        val legal = legalOffset(j.reqString("legalTimestamp"), "legalTimestamp")
        val interrupted = legalOffset(j.reqString("interruptionStartedAt"), "interruptionStartedAt")
        require(!interrupted.toInstant().isAfter(legal.toInstant())) { "Interruption starts after legal timestamp" }
        return CashIssueRequest(j, operation, authority, template)
    }

    fun deriveIds(operationId: UUID): DerivedIds {
        val receipt = FiscalCrypto.uuidV5(operationId, "receipt")
        return DerivedIds(
            receipt,
            FiscalCrypto.uuidV5(operationId, "issue-reservation"),
            FiscalCrypto.uuidV5(operationId, "furs-snapshot"),
            FiscalCrypto.uuidV5(operationId, "furs-artifact"),
        )
    }

    fun materializeAndSign(
        request: CashIssueRequest,
        sequence: Long,
        issuedAt: String,
        taxNumber: String,
        fursPrivateKey: PrivateKey,
        fursCertificate: X509Certificate,
        devicePrivateKey: PrivateKey,
        devicePublicKeyPem: String,
    ): Result {
        require(sequence in 1..9_999_999) { "Invalid atomically allocated PP-B sequence" }
        require(taxNumber.matches(Regex("[0-9]{8}"))) { "Invalid FURS tax number" }
        val issued = legalOffset(issuedAt, "issuedAt")
        require(issuedAt == request.json.reqString("legalTimestamp")) { "issuedAt differs from legalTimestamp" }
        val validity = request.authority.json.reqObject("validity")
        require(!issued.toInstant().isBefore(OffsetDateTime.parse(validity.reqString("validFrom")).toInstant()) &&
            !issued.toInstant().isAfter(OffsetDateTime.parse(validity.reqString("validUntil")).toInstant())) {
            "issuedAt outside authority validity"
        }
        val ids = deriveIds(request.operationId)
        val template = request.template.json
        val authority = request.authority.json
        val b = authority.reqObject("scope").reqString("bIdentifier")
        val pp = premiseFromReceiptSeed(template.reqObject("print").reqString("receiptNumber"), b)
        identifier(pp, "business premise")
        val legalNumber = "$pp-$b-$sequence"
        val localDateTime = issued.atZoneSameInstant(LJUBLJANA).format(LOCAL_TIME)
        val gross = money(template.reqObject("totals"), "gross")
        val zoiInputString = taxNumber + issued.atZoneSameInstant(LJUBLJANA).format(ZOI_TIME) +
            gross.setScale(2).toPlainString() + legalNumber + pp + b
        val zoiInput = zoiInputString.toByteArray(StandardCharsets.UTF_8)
        val zoiSignature = sign(fursPrivateKey, zoiInput)
        val zoi = MessageDigest.getInstance("MD5").digest(zoiSignature).hex()
        val fingerprint = "sha256:${sha256(fursCertificate.encoded)}"
        val taxes = taxes(template.reqObject("totals").reqArray("vatGroups"))
        val fields = JSONObject()
            .put("taxNumber", taxNumber).put("issueDateTime", localDateTime).put("invoiceNumber", sequence)
            .put("businessPremiseId", pp).put("electronicDeviceId", b)
            .put("invoiceAmount", gross.setScale(2).toPlainString()).put("paymentAmount", gross.setScale(2).toPlainString())
            .put("numberingStructure", "B")
        template.reqObject("print").optStringOrNull("customerTaxNumber")?.let { fields.put("customerTaxNumber", it) }
        template.reqObject("operator").optStringOrNull("taxNumber")?.let { fields.put("operatorTaxNumber", it) }
        fields.put("taxesPerSeller", taxes).put("zoiInput", zoiInputString).put("zoi", zoi)
            .put("certificateFingerprint", fingerprint)
        val plan = materializePlan(template, authority, ids, sequence, issuedAt, legalNumber, pp, b,
            "offline:${request.operationId}")
        val planBytes = FiscalCrypto.canonicalJson(plan)
        val planHash = sha256(planBytes)
        val publicKeyDer = Base64.getMimeDecoder().decode(devicePublicKeyPem
            .substringAfter("-----BEGIN PUBLIC KEY-----").substringBefore("-----END PUBLIC KEY-----"))
        val core = JSONObject().put("envelopeVersion", "furs-v2")
            .put("operationId", request.operationId.toString()).put("localReceiptId", ids.localReceiptId.toString())
            .put("authorityBundle", clone(authority)).put("finalizationPlan", clone(plan))
            .put("finalizationPlanSha256", planHash).put("legalInvoice", clone(fields))
            .put("zoiSignatureBase64", Base64.getEncoder().encodeToString(zoiSignature))
            .put("certificateFingerprint", fingerprint)
            .put("deviceKeyFingerprintSha256", sha256(publicKeyDer))
        val signatureMessage = FiscalCrypto.canonicalJson(core)
        val deviceSignature = sign(devicePrivateKey, signatureMessage)
        core.put("deviceSignatureBase64", Base64.getEncoder().encodeToString(deviceSignature))
        return Result(ids, plan, planBytes, planHash, fields, zoiInput, zoiSignature, zoi, fingerprint,
            signatureMessage, deviceSignature, core, FiscalCrypto.canonicalJson(core))
    }

    /** Validates/recalculates the legal (non-transport) evidence of a v2 core. */
    fun verifyLegalCore(core: JSONObject, fursPublicKey: java.security.PublicKey): Boolean = try {
        require(core.reqString("envelopeVersion") == "furs-v2")
        val plan = core.reqObject("finalizationPlan")
        require(sha256(FiscalCrypto.canonicalJson(plan)) == core.reqString("finalizationPlanSha256"))
        val receipt = plan.reqObject("receipt")
        val legal = core.reqObject("legalInvoice")
        val local = LocalDateTime.parse(legal.reqString("issueDateTime"), LOCAL_TIME)
        val legalNumber = receipt.reqString("legalNumber")
        val expectedInput = legal.reqString("taxNumber") + local.format(ZOI_TIME) +
            BigDecimal(legal.reqString("invoiceAmount")).setScale(2).toPlainString() + legalNumber +
            legal.reqString("businessPremiseId") + legal.reqString("electronicDeviceId")
        require(expectedInput == legal.reqString("zoiInput"))
        val zoiSignature = Base64.getDecoder().decode(core.reqString("zoiSignatureBase64"))
        require(Signature.getInstance("SHA256withRSA").run {
            initVerify(fursPublicKey); update(expectedInput.toByteArray(StandardCharsets.UTF_8)); verify(zoiSignature)
        })
        require(MessageDigest.getInstance("MD5").digest(zoiSignature).hex() == legal.reqString("zoi"))
        true
    } catch (_: Exception) { false }

    fun materializeAndSign(
        request: CashIssueRequest, sequence: Long, issuedAt: String, taxNumber: String,
        fursKeyStore: KeyStore, fursAlias: String, keyPassword: CharArray?,
        devicePrivateKey: PrivateKey, devicePublicKeyPem: String,
    ): Result {
        val key = fursKeyStore.getKey(fursAlias, keyPassword) as? PrivateKey
            ?: throw IllegalArgumentException("FURS alias does not contain a private key")
        val cert = fursKeyStore.getCertificate(fursAlias) as? X509Certificate
            ?: throw IllegalArgumentException("FURS alias does not contain an X509 certificate")
        return materializeAndSign(request, sequence, issuedAt, taxNumber, key, cert, devicePrivateKey,
            devicePublicKeyPem)
    }

    fun materializeAndSign(
        request: CashIssueRequest, sequence: Long, issuedAt: String, taxNumber: String,
        fursKeyStore: KeyStore, fursAlias: String, fursKeyPassword: CharArray?,
        deviceKeyStore: KeyStore, deviceAlias: String, deviceKeyPassword: CharArray?,
    ): Result {
        val deviceKey = deviceKeyStore.getKey(deviceAlias, deviceKeyPassword) as? PrivateKey
            ?: throw IllegalArgumentException("Device alias does not contain a private key")
        val deviceCertificate = deviceKeyStore.getCertificate(deviceAlias)
            ?: throw IllegalArgumentException("Device alias does not contain a certificate")
        val devicePem = "-----BEGIN PUBLIC KEY-----\n" +
            Base64.getEncoder().encodeToString(deviceCertificate.publicKey.encoded)
                .chunked(64).joinToString("\n") +
            "\n-----END PUBLIC KEY-----\n"
        return materializeAndSign(request, sequence, issuedAt, taxNumber, fursKeyStore, fursAlias,
            fursKeyPassword, deviceKey, devicePem)
    }

    private fun materializePlan(t: JSONObject, a: JSONObject, ids: DerivedIds, sequence: Long, issuedAt: String,
                                legal: String, pp: String, b: String, requestHash: String): JSONObject {
        val out = clone(t)
        out.remove("receiptContext")
        val ctx = t.reqObject("receiptContext")
        out.put("receipt", JSONObject().put("localReceiptId", ids.localReceiptId.toString())
            .put("companyId", ctx.reqString("companyId")).put("enotaId", ctx.reqLong("enotaId"))
            .put("orderId", ctx.reqLong("orderId")).put("legalNumber", legal).put("pp", pp).put("b", b)
            .put("ppBSequence", sequence).put("issuedAt", issuedAt).put("isPartial", ctx.reqBoolean("isPartial")))
        out.reqObject("print").put("receiptNumber", legal).put("issuedAt", issuedAt)
        out.put("reservations", JSONObject().put("issueReservationId", ids.issueReservationId.toString()))
        out.put("furs", JSONObject().put("snapshotId", ids.snapshotId.toString()).put("requestHash", requestHash)
            .put("canonicalArtifactLink", "offline:${out.reqString("sourceOperationId")}"))
        return out
    }

    private fun routingFields(r: CashIssueRequest, sequence: Long, issuedAt: String, pp: String, b: String): JSONObject {
        val a = r.authority.json
        val t = r.template.json
        val payment = t.reqObject("payment")
        val method = when (payment.reqString("method")) {
            "gotovina" -> "cash"; "kartica" -> "card"; "bon" -> "voucher"; else -> "other"
        }
        return JSONObject().put("operationId", r.operationId.toString())
            .put("deviceId", a.reqObject("scope").reqString("deviceId"))
            .put("poslovniProstorId", a.reqObject("scope").reqLong("premiseId"))
            .put("poslovniProstorOznaka", pp).put("bIdentifier", b).put("sequence", sequence)
            .put("issuedAt", issuedAt).put("interruptionStartedAt", r.json.reqString("interruptionStartedAt"))
            .put("orderId", t.reqObject("receiptContext").reqLong("orderId"))
            .put("operatorReference", t.reqObject("operator").reqLong("waiterId").toString())
            .put("paymentReference", payment.optStringOrNull("terminalReferenceReservationId") ?: JSONObject.NULL)
            .put("paymentMethod", method)
    }

    private fun taxes(groups: JSONArray): JSONArray {
        require(groups.length() > 0) { "At least one VAT group is required" }
        val rows = (0 until groups.length()).map {
            val g = groups.getJSONObject(it)
            val rate = decimal(g, "rate")
            val gross = decimal(g, "gross")
            val vat = decimal(g, "vat")
            require(rate.signum() >= 0 && gross.subtract(vat).scaleAtMost(2)) { "Invalid VAT group" }
            Triple(rate, gross.subtract(vat), vat)
        }.sortedBy { it.first }
        return JSONArray().also { out -> rows.forEach { (r, taxable, vat) ->
            out.put(JSONObject().put("taxRate", r.setScale(2).toPlainString())
                .put("taxableAmount", taxable.setScale(2).toPlainString())
                .put("taxAmount", vat.setScale(2).toPlainString()))
        } }
    }

    private fun invoiceXml(f: JSONObject): String {
        val vat = f.reqArray("taxesPerSeller")
        val vatXml = buildString { for (i in 0 until vat.length()) {
            val v = vat.getJSONObject(i)
            append("<fu:VAT><fu:TaxRate>${v.reqString("taxRate")}</fu:TaxRate>")
            append("<fu:TaxableAmount>${v.reqString("taxableAmount")}</fu:TaxableAmount>")
            append("<fu:TaxAmount>${v.reqString("taxAmount")}</fu:TaxAmount></fu:VAT>")
        } }
        return "<fu:InvoiceRequest xmlns:fu='http://www.fu.gov.si/' Id='${f.reqString("invoiceRequestId")}'>" +
            "<fu:Header><fu:MessageID>${f.reqString("messageId")}</fu:MessageID><fu:DateTime>${f.reqString("issueDateTime")}</fu:DateTime></fu:Header>" +
            "<fu:Invoice><fu:TaxNumber>${f.reqString("taxNumber")}</fu:TaxNumber><fu:IssueDateTime>${f.reqString("issueDateTime")}</fu:IssueDateTime>" +
            "<fu:NumberingStructure>B</fu:NumberingStructure><fu:InvoiceIdentifier><fu:BusinessPremiseID>${xml(f.reqString("businessPremiseId"))}</fu:BusinessPremiseID>" +
            "<fu:ElectronicDeviceID>${xml(f.reqString("electronicDeviceId"))}</fu:ElectronicDeviceID><fu:InvoiceNumber>${f.reqLong("invoiceNumber")}</fu:InvoiceNumber></fu:InvoiceIdentifier>" +
            (f.optStringOrNull("customerTaxNumber")?.let { "<fu:CustomerTaxNumber>${xml(it)}</fu:CustomerTaxNumber>" } ?: "") +
            "<fu:InvoiceAmount>${f.reqString("invoiceAmount")}</fu:InvoiceAmount><fu:PaymentAmount>${f.reqString("paymentAmount")}</fu:PaymentAmount>" +
            "<fu:TaxesPerSeller>$vatXml</fu:TaxesPerSeller>" +
            (f.optStringOrNull("operatorTaxNumber")?.let { "<fu:OperatorTaxNumber>${xml(it)}</fu:OperatorTaxNumber>" } ?: "") +
            "<fu:ProtectedID>${f.reqString("zoi")}</fu:ProtectedID></fu:Invoice></fu:InvoiceRequest>"
    }

    /** Reproduces xml-crypto inclusive C14N and serialization used by the server contract. */
    private fun signSoap(invoice: String, id: String, key: PrivateKey, cert: X509Certificate): ByteArray {
        val normalizedInvoice = invoice.replace('\'', '"')
        val canonicalRequest = normalizedInvoice.replace(
            "<fu:InvoiceRequest xmlns:fu=\"http://www.fu.gov.si/\" Id=\"$id\">",
            "<fu:InvoiceRequest xmlns:fu=\"http://www.fu.gov.si/\" xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:xd=\"$DS\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" Id=\"$id\">"
        )
        val digest = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256")
            .digest(canonicalRequest.toByteArray(StandardCharsets.UTF_8)))
        val signedInfo = "<SignedInfo><CanonicalizationMethod Algorithm=\"$C14N\"/>" +
            "<SignatureMethod Algorithm=\"$RSA_SHA256\"/><Reference URI=\"#$id\"><Transforms>" +
            "<Transform Algorithm=\"$ENVELOPED\"/><Transform Algorithm=\"$C14N\"/></Transforms>" +
            "<DigestMethod Algorithm=\"$SHA256\"/><DigestValue>$digest</DigestValue></Reference></SignedInfo>"
        val canonicalSignedInfo = signedInfo.replace("<SignedInfo>",
            "<SignedInfo xmlns=\"$DS\" xmlns:fu=\"http://www.fu.gov.si/\" xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:xd=\"$DS\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">")
            .replace("<CanonicalizationMethod Algorithm=\"$C14N\"/>",
                "<CanonicalizationMethod Algorithm=\"$C14N\"></CanonicalizationMethod>")
            .replace("<SignatureMethod Algorithm=\"$RSA_SHA256\"/>",
                "<SignatureMethod Algorithm=\"$RSA_SHA256\"></SignatureMethod>")
            .replace("<Transform Algorithm=\"$ENVELOPED\"/>",
                "<Transform Algorithm=\"$ENVELOPED\"></Transform>")
            .replace("<Transform Algorithm=\"$C14N\"/>",
                "<Transform Algorithm=\"$C14N\"></Transform>")
            .replace("<DigestMethod Algorithm=\"$SHA256\"/>",
                "<DigestMethod Algorithm=\"$SHA256\"></DigestMethod>")
        val signature = Base64.getEncoder().encodeToString(sign(key, canonicalSignedInfo.toByteArray(StandardCharsets.UTF_8)))
        val issuer = xml(cert.issuerX500Principal.name)
        val cert64 = Base64.getEncoder().encodeToString(cert.encoded)
        val signatureXml = "<Signature xmlns=\"$DS\">$signedInfo<SignatureValue>$signature</SignatureValue><KeyInfo><X509Data>" +
            "<X509IssuerSerial><X509IssuerName>$issuer</X509IssuerName><X509SerialNumber>${cert.serialNumber}</X509SerialNumber></X509IssuerSerial>" +
            "<X509Certificate>$cert64</X509Certificate></X509Data></KeyInfo></Signature>"
        val signedInvoice = normalizedInvoice.replace("</fu:InvoiceRequest>", "$signatureXml</fu:InvoiceRequest>")
        return ("<?xml version='1.0' encoding='UTF-8'?><soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"" +
            " xmlns:xd=\"$DS\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"><soapenv:Header/><soapenv:Body>" +
            signedInvoice + "</soapenv:Body></soapenv:Envelope>").toByteArray(StandardCharsets.UTF_8)
    }

    private fun sign(key: PrivateKey, bytes: ByteArray) = Signature.getInstance("SHA256withRSA").run {
        initSign(key); update(bytes); sign()
    }
    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
    private fun clone(j: JSONObject) = JSONObject(j.toString())
    private fun parseObject(s: String, name: String): JSONObject = try {
        require(!s.startsWith("\uFEFF")) { "$name must be UTF-8 without BOM" }; JSONObject(s)
    } catch (e: Exception) { throw IllegalArgumentException("Invalid $name JSON", e) }
    private fun uuid(s: String, name: String) = try { UUID.fromString(s).also {
        require(it.toString() == s.lowercase()) { "Non-canonical $name" }
    } } catch (e: Exception) { throw IllegalArgumentException("Invalid $name", e) }
    private fun identifier(s: String, name: String) =
        require(s.matches(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,39}"))) { "Invalid $name" }
    private fun premiseFromReceiptSeed(seed: String, bIdentifier: String): String =
        seed.replace(Regex("-${Regex.escape(bIdentifier)}-[0-9]+$"), "")
    private fun hex64(s: String, name: String) = require(s.matches(Regex("[0-9a-f]{64}"))) { "Invalid $name" }
    private fun decodeBase64(s: String, name: String) = try {
        require(Base64.getEncoder().encodeToString(Base64.getDecoder().decode(s)) == s)
    } catch (e: Exception) { throw IllegalArgumentException("Invalid $name", e) }
    private fun legalOffset(s: String, name: String): OffsetDateTime = try {
        // RFC3339 permits Z as well as any numeric offset.  The offset describes
        // an instant; Europe/Ljubljana is applied only when deriving legal/FURS
        // local calendar fields.
        OffsetDateTime.parse(s)
    } catch (e: Exception) { throw IllegalArgumentException("Invalid $name", e) }
    private fun exactKeys(j: JSONObject, expected: Set<String>, name: String) {
        val actual = j.keys().asSequence().toSet()
        require(actual == expected) { "Invalid $name fields: missing=${expected-actual}, unknown=${actual-expected}" }
    }
    private fun validateOperator(j: JSONObject, name: String, allowActor: Boolean) {
        exactKeys(j, setOf("waiterId", "name", "taxNumber", "shiftId") + if (allowActor) setOf("actor") else emptySet(), name)
        j.reqPositiveLong("waiterId"); j.reqPositiveLong("shiftId")
        require(j.reqString("name").isNotBlank() && j.reqString("taxNumber").matches(Regex("[0-9]{8}")))
        if (allowActor) require(j.reqString("actor").isNotBlank())
    }
    private fun validateFiniteTree(v: Any?, path: String) {
        when (v) {
            is Double -> require(v.isFinite() && v != -0.0) { "Invalid number at $path" }
            is Float -> require(v.isFinite() && v != -0.0f) { "Invalid number at $path" }
            is JSONObject -> v.keys().forEach { validateFiniteTree(v.get(it), "$path.$it") }
            is JSONArray -> for (i in 0 until v.length()) validateFiniteTree(v.get(i), "$path[$i]")
        }
    }
    private fun decimal(j: JSONObject, key: String): BigDecimal = try {
        BigDecimal(j.get(key).toString()).also { require(it.scale() <= 8) }
    } catch (e: Exception) { throw IllegalArgumentException("Invalid decimal $key", e) }
    private fun money(j: JSONObject, key: String) = decimal(j, key).setScale(2)
    private fun BigDecimal.scaleAtMost(n: Int) = try { setScale(n); true } catch (_: ArithmeticException) { false }
    private fun xml(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\"", "&quot;").replace("\r", "&#xD;")

    private fun JSONObject.reqString(k: String): String {
        require(has(k) && !isNull(k) && get(k) is String) { "Missing/string field $k" }; return getString(k)
    }
    private fun JSONObject.reqObject(k: String): JSONObject {
        require(has(k) && get(k) is JSONObject) { "Missing/object field $k" }; return getJSONObject(k)
    }
    private fun JSONObject.reqArray(k: String): JSONArray {
        require(has(k) && get(k) is JSONArray) { "Missing/array field $k" }; return getJSONArray(k)
    }
    private fun JSONObject.reqLong(k: String): Long {
        val v = get(k); require(v is Byte || v is Short || v is Int || v is Long) { "Missing/integer field $k" }
        return (v as Number).toLong()
    }
    private fun JSONObject.reqPositiveLong(k: String) = reqLong(k).also { require(it > 0) { "$k must be positive" } }
    private fun JSONObject.reqBoolean(k: String): Boolean {
        require(get(k) is Boolean) { "Missing/boolean field $k" }; return getBoolean(k)
    }
    private fun JSONObject.optStringOrNull(k: String): String? =
        if (!has(k) || isNull(k)) null else reqString(k).also { require(it.isNotBlank()) }
}

/** Stable public name for integrations preferring an engine noun. */
typealias FursCryptographicEngine = DynamicFursEngine