package si.bookie.fiscal

import android.content.Context
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/** Runs the furs-v2 legal-core cryptographic conformance checks at startup.
 * SOAP/XMLDSig attempt vectors are deliberately not materialised on-device. */
object RuntimeGoldenAttestation {
    fun verify(context: Context): String {
        val vectors = context.assets.open("golden-vectors-furs-v2.json").bufferedReader().use { JSONObject(it.readText()) }
        val certificate = context.assets.open("test-fixtures/FURS-V1-GOLDEN-TEST-ONLY-certificate.pem").use {
            CertificateFactory.getInstance("X.509").generateCertificate(it) as java.security.cert.X509Certificate
        }
        return verify(vectors, certificate)
    }

    fun verify(vectors: JSONObject, certificate: java.security.cert.X509Certificate): String {
        val core = vectors.getJSONObject("legalCore")
        check(core.getString("envelopeVersion") == "furs-v2")
        check(FiscalLedger.sha256(FiscalCrypto.canonicalJson(core.getJSONObject("finalizationPlan"))) ==
            core.getString("finalizationPlanSha256"))
        val publicDer = Base64.getMimeDecoder().decode(vectors.getJSONObject("testAuthority").getString("publicKeyPem")
            .substringAfter("-----BEGIN PUBLIC KEY-----").substringBefore("-----END PUBLIC KEY-----"))
        check(FiscalLedger.sha256(publicDer) == core.getString("deviceKeyFingerprintSha256"))
        check("sha256:${FiscalLedger.sha256(certificate.encoded)}" == core.getString("certificateFingerprint"))
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(publicDer))
        // This invokes the runtime FURS-v2 legal-core/ZOI generator-verifier;
        // it contains no SOAP or XMLDSig construction.
        check(DynamicFursEngine.verifyLegalCore(core, key)) { "RUNTIME_GOLDEN_MISMATCH:legalCore" }
        val unsigned = JSONObject(core.toString()).apply { remove("deviceSignatureBase64") }
        check(Signature.getInstance("SHA256withRSA").run {
            initVerify(key); update(FiscalCrypto.canonicalJson(unsigned))
            verify(Base64.getDecoder().decode(core.getString("deviceSignatureBase64")))
        })
        // Attempts are public server-contract fixtures only. Check their stated
        // immutable byte hashes without generating SOAP locally.
        val attempts = vectors.getJSONArray("transportAttempts")
        for (i in 0 until attempts.length()) {
            val a = attempts.getJSONObject(i)
            check("sha256:${FiscalLedger.sha256(Base64.getDecoder().decode(a.getString("signedXmlBase64")))}" ==
                a.getString("signedXmlSha256"))
        }
        val attestation = vectors.getJSONObject("goldenAttestation")
        check(FiscalLedger.sha256(attestation.getString("aggregationInputUtf8").toByteArray(StandardCharsets.UTF_8)) ==
            attestation.getString("goldenAttestationSha256"))
        return attestation.getString("goldenAttestationSha256")
    }
}