package si.bookie.fiscal

import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.Base64
import java.util.UUID

/** Closed-schema verifier for the paired /provisioning/install boundary. */
object ProvisioningVerifier {
    data class Result(val canonical: ByteArray, val bundleId: String, val version: Int)

    fun verify(
        bundle: JSONObject,
        trust: ProductionTrust,
        deviceFingerprint: String,
        minimumVersion: Int,
        goldenAttestationSha256: String,
        now: Instant = Instant.now(),
    ): Result {
        exact(bundle, setOf("schema", "bundleId", "version", "device", "authority", "furs", "pos",
            "sync", "contract", "authentication", "revocation", "validity", "payloadSha256", "signatureBase64"))
        require(bundle.getString("schema") == "bookie-offline-provisioning-v1") { "PROVISIONING_SCHEMA" }
        UUID.fromString(bundle.getString("bundleId"))
        val version = bundle.getInt("version")
        require(version >= minimumVersion) { "PROVISIONING_ROLLBACK" }

        val device = bundle.getJSONObject("device")
        exact(device, setOf("id", "companyId", "enotaId", "poslovniProstorId",
            "poslovniProstorOznaka", "bIdentifier", "publicKeyFingerprintSha256"))
        UUID.fromString(device.getString("id")); UUID.fromString(device.getString("companyId"))
        require(device.getLong("enotaId") > 0 && device.getLong("poslovniProstorId") > 0) { "PROVISIONING_SCOPE" }
        require(device.getString("bIdentifier").matches(Regex("[A-Za-z0-9]{1,20}"))) { "PROVISIONING_SCOPE" }
        require(constantTime(device.getString("publicKeyFingerprintSha256"), deviceFingerprint)) {
            "PROVISIONING_DEVICE_FINGERPRINT"
        }

        val authority = bundle.getJSONObject("authority")
        exact(authority, setOf("keyId", "publicKeyPem", "version", "algorithm"))
        require(authority.getString("keyId") == trust.keyId &&
            authority.getString("algorithm") == "RSA-SHA256" && authority.getInt("version") >= 1) {
            "PROVISIONING_AUTHORITY"
        }
        // publicKeyPem is intentionally not parsed or used. Trust is exclusively build-pinned.
        val contract = bundle.getJSONObject("contract")
        exact(contract, setOf("version", "goldenAttestationSha256"))
        require(contract.getString("version") == "furs-v2" &&
            constantTime(contract.getString("goldenAttestationSha256"), goldenAttestationSha256)) {
            "PROVISIONING_ATTESTATION"
        }
        val validity = bundle.getJSONObject("validity")
        exact(validity, setOf("validFrom", "validUntil"))
        val from = Instant.parse(validity.getString("validFrom"))
        val until = Instant.parse(validity.getString("validUntil"))
        require(!now.isBefore(from) && !now.isAfter(until) && until.isAfter(from)) { "PROVISIONING_VALIDITY" }

        exact(bundle.getJSONObject("furs"), setOf("expectedCertificateFingerprint"))
        exact(bundle.getJSONObject("pos"), setOf("allowedHttpsOrigins"))
        exact(bundle.getJSONObject("sync"), setOf("httpsBaseUrl", "ingestPath", "statusPathTemplate",
            "configPath", "maxBodyBytes"))
        require(bundle.getJSONObject("sync").getString("httpsBaseUrl").startsWith("https://")) {
            "PROVISIONING_SYNC_HTTPS"
        }
        exact(bundle.getJSONObject("authentication"), setOf("timestampToleranceSeconds", "nonceMinBits",
            "nonceRetentionSeconds", "signatureInput"))
        val revocation = bundle.getJSONObject("revocation")
        exact(revocation, setOf("deviceVersion", "minimumAcceptedVersion"))
        require(version >= revocation.getInt("minimumAcceptedVersion") &&
            revocation.getInt("deviceVersion") >= revocation.getInt("minimumAcceptedVersion")) {
            "PROVISIONING_REVOKED"
        }

        val unsigned = JSONObject(bundle.toString()).apply {
            remove("payloadSha256"); remove("signatureBase64")
        }
        val canonical = FiscalCrypto.canonicalJson(unsigned)
        require(constantTime(FiscalLedger.sha256(canonical), bundle.getString("payloadSha256"))) {
            "PROVISIONING_HASH"
        }
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(pemDer(trust.publicKeyPem)))
        val signature = Base64.getDecoder().decode(bundle.getString("signatureBase64"))
        require(Signature.getInstance("SHA256withRSA").run {
            initVerify(key); update(canonical); verify(signature)
        }) { "PROVISIONING_SIGNATURE" }
        return Result(FiscalCrypto.canonicalJson(bundle), bundle.getString("bundleId"), version)
    }

    private fun exact(value: JSONObject, keys: Set<String>) =
        require(value.keys().asSequence().toSet() == keys) { "PROVISIONING_CLOSED_SCHEMA" }

    private fun pemDer(value: String): ByteArray = Base64.getMimeDecoder().decode(
        value.substringAfter("-----BEGIN PUBLIC KEY-----").substringBefore("-----END PUBLIC KEY-----")
    )
    private fun constantTime(a: String, b: String) = MessageDigest.isEqual(
        a.toByteArray(StandardCharsets.US_ASCII), b.toByteArray(StandardCharsets.US_ASCII)
    )
}