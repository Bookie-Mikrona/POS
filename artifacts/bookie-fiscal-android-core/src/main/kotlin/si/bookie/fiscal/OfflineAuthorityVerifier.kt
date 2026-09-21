package si.bookie.fiscal

import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Base64

/** Fail-closed verification of the contract OfflineAuthorityBundle trust boundary. */
object OfflineAuthorityVerifier {
    data class Expected(
        val trustedAuthorityPublicKeyPem: String,
        val authorityKeyId: String,
        val minimumAuthorityVersion: Int,
        val goldenAttestationSha256: String,
        val companyId: String,
        val enotaId: Long,
        val deviceId: String,
        val premiseId: Long,
        val bIdentifier: String,
        val premiseLabel: String? = null,
        val revokedBundleIds: Set<String> = emptySet(),
    )

    fun verify(bundle: JSONObject, expected: Expected, now: Instant = Instant.now()) {
        require(bundle.getString("schema") == "bookie-offline-authority-v1") { "AUTHORITY_SCHEMA" }
        require(bundle.getString("bundleId") !in expected.revokedBundleIds) { "AUTHORITY_REVOKED" }
        val server = bundle.getJSONObject("server")
        val scope = bundle.getJSONObject("scope")
        val contract = bundle.getJSONObject("contract")
        val validity = bundle.getJSONObject("validity")
        val authority = bundle.getJSONObject("authority")
        require(server.getString("companyId") == expected.companyId && server.getLong("enotaId") == expected.enotaId) {
            "AUTHORITY_SERVER_SCOPE"
        }
        require(scope.getString("deviceId") == expected.deviceId &&
            scope.getLong("premiseId") == expected.premiseId &&
            scope.getString("bIdentifier") == expected.bIdentifier) { "AUTHORITY_DEVICE_SCOPE" }
        require(contract.getString("version") == "furs-v2" &&
            contract.getString("goldenAttestationSha256") == expected.goldenAttestationSha256 &&
            contract.getInt("authorityVersion") >= expected.minimumAuthorityVersion) { "AUTHORITY_CONTRACT" }
        require(validity.getInt("outageSubmissionBusinessDays") == 2) { "AUTHORITY_DEADLINE_POLICY" }
        val from = OffsetDateTime.parse(validity.getString("validFrom")).toInstant()
        val until = OffsetDateTime.parse(validity.getString("validUntil")).toInstant()
        require(!now.isBefore(from) && !now.isAfter(until)) { "AUTHORITY_EXPIRED" }
        require(authority.getString("algorithm") == "RSA-SHA256" &&
            authority.getString("keyId") == expected.authorityKeyId) { "AUTHORITY_KEY" }
        require(normalizePem(authority.getString("publicKeyPem")) == normalizePem(expected.trustedAuthorityPublicKeyPem)) {
            "AUTHORITY_UNTRUSTED_KEY"
        }

        val unsigned = JSONObject(bundle.toString()).apply {
            remove("bundleSha256")
            remove("signatureBase64")
        }
        val canonical = FiscalCrypto.canonicalJson(unsigned)
        val actualHash = FiscalLedger.sha256(canonical)
        require(constantTime(actualHash, bundle.getString("bundleSha256"))) { "AUTHORITY_HASH" }
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(pemDer(expected.trustedAuthorityPublicKeyPem)))
        val valid = Signature.getInstance("SHA256withRSA").run {
            initVerify(key)
            update(canonical)
            verify(Base64.getDecoder().decode(bundle.getString("signatureBase64")))
        }
        require(valid) { "AUTHORITY_SIGNATURE" }
    }

    private fun normalizePem(value: String) = value.replace("\r\n", "\n").trim() + "\n"
    private fun pemDer(value: String): ByteArray = Base64.getMimeDecoder().decode(
        value.substringAfter("-----BEGIN PUBLIC KEY-----").substringBefore("-----END PUBLIC KEY-----")
    )
    private fun constantTime(a: String, b: String) = MessageDigest.isEqual(
        a.toByteArray(StandardCharsets.US_ASCII), b.toByteArray(StandardCharsets.US_ASCII)
    )
}