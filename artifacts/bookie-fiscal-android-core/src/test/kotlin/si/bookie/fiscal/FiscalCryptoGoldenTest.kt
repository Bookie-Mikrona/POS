package si.bookie.fiscal

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.security.cert.CertificateFactory
import java.time.ZoneId
import java.util.Base64
import java.util.UUID

class FiscalCryptoGoldenTest {
    private fun vectors(): JSONObject {
        var at = File(System.getProperty("user.dir")).absoluteFile
        repeat(8) {
            val candidate = File(at, "fiscal-service/contract/golden-vectors-v1.json")
            if (candidate.isFile) return JSONObject(candidate.readText(Charsets.UTF_8))
            at = at.parentFile ?: at
        }
        error("Normative golden-vectors-v1.json not found")
    }

    private fun fursVectors(): JSONObject {
        var at = File(System.getProperty("user.dir")).absoluteFile
        repeat(8) {
            val candidate = File(at, "fiscal-service/contract/golden-vectors-furs-v1.json")
            if (candidate.isFile) return JSONObject(candidate.readText(Charsets.UTF_8))
            at = at.parentFile ?: at
        }
        error("Normative golden-vectors-furs-v1.json not found")
    }

    @Test fun canonicalHashAndZoiMatchNormativeVector() {
        val vector = vectors().getJSONArray("vectors").getJSONObject(0)
        val canonical = FiscalCrypto.canonicalJson(vector.getJSONObject("canonicalPayload"))
        assertEquals(vector.getString("canonicalUtf8"), String(canonical, Charsets.UTF_8))
        assertEquals(vector.getString("payloadSha256"), FiscalLedger.sha256(canonical))
        val payload = vector.getJSONObject("canonicalPayload")
        assertEquals(vector.getString("zoiInputUtf8"), String(FiscalCrypto.zoiInput(
            payload.getJSONObject("company").getString("taxNumber"),
            payload.getString("legalTimestamp"), 1,
            payload.getJSONObject("premise").getString("label"),
            payload.getJSONObject("device").getString("bIdentifier"),
            payload.getJSONObject("totals").getString("gross"),
        ), Charsets.UTF_8))
        val zoiSignature = Base64.getDecoder().decode(vector.getString("zoiSignatureBase64"))
        assertEquals(vector.getString("zoi"), FiscalCrypto.zoi(zoiSignature))
    }

    @Test fun goldenRsaSignaturesVerify() {
        val vector = vectors().getJSONArray("vectors").getJSONObject(0)
        val pem = vector.getString("publicKeyPem")
        val der = Base64.getMimeDecoder().decode(pem.substringAfter("-----BEGIN PUBLIC KEY-----")
            .substringBefore("-----END PUBLIC KEY-----"))
        val key = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
        fun verify(message: String, signature: String): Boolean = Signature.getInstance("SHA256withRSA").run {
            initVerify(key); update(message.toByteArray(Charsets.UTF_8)); verify(Base64.getDecoder().decode(signature))
        }
        assertTrue(verify(vector.getString("zoiInputUtf8"), vector.getString("zoiSignatureBase64")))
        assertTrue(verify(vector.getString("deviceSignatureMessageUtf8"), vector.getString("deviceSignatureBase64")))
    }

    @Test fun deadlineUsesLjubljanaAndSkipsWeekendAndProvisionedHoliday() {
        val zone = ZoneId.of("Europe/Ljubljana")
        val friday = java.time.OffsetDateTime.parse("2025-01-03T10:15:30+01:00").toInstant().toEpochMilli()
        val tuesday = FiscalLedger.twoBusinessDayDeadline(friday, zone)
        assertEquals("2025-01-07T10:15:30+01:00",
            java.time.Instant.ofEpochMilli(tuesday).atZone(zone).toOffsetDateTime().toString())
        val monday = java.time.OffsetDateTime.parse("2025-01-06T10:15:30+01:00").toInstant().toEpochMilli()
        val thursday = FiscalLedger.twoBusinessDayDeadline(monday, zone, setOf("2025-01-07"))
        assertEquals("2025-01-09T10:15:30+01:00",
            java.time.Instant.ofEpochMilli(thursday).atZone(zone).toOffsetDateTime().toString())
    }

    @Test fun negativeZeroCanonicalValueIsRejected() {
        var rejected = false
        try { FiscalCrypto.canonicalJson(JSONObject().put("amount", -0.0)) } catch (_: IllegalArgumentException) { rejected = true }
        assertTrue("Negative zero must be rejected", rejected)
    }

    @Test fun authorityBundleRequiresTrustedSignatureHashScopeAndValidity() {
        val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val pemBody = Base64.getEncoder().encodeToString(keys.public.encoded).chunked(64).joinToString("\n")
        val pem = "-----BEGIN PUBLIC KEY-----\n$pemBody\n-----END PUBLIC KEY-----\n"
        val bundle = JSONObject("""{
          "schema":"bookie-offline-authority-v1","bundleId":"11111111-1111-4111-8111-111111111111",
          "server":{"companyId":"c","enotaId":3},
          "scope":{"deviceId":"d","premiseId":19,"bIdentifier":"B01"},
           "contract":{"version":"furs-v2","goldenAttestationSha256":"abc","authorityVersion":2},
          "validity":{"validFrom":"2025-01-01T00:00:00+01:00","validUntil":"2025-12-31T23:59:59+01:00","outageSubmissionBusinessDays":2},
          "operator":{},"catalog":[],"modifiers":[],"policies":{},
          "authority":{"keyId":"root-1","algorithm":"RSA-SHA256","publicKeyPem":${JSONObject.quote(pem)}}
        }""")
        val unsigned = FiscalCrypto.canonicalJson(bundle)
        bundle.put("bundleSha256", FiscalLedger.sha256(unsigned))
        bundle.put("signatureBase64", FiscalCrypto.signatureBase64(keys.private, unsigned))
        val expected = OfflineAuthorityVerifier.Expected(pem, "root-1", 2, "abc", "c", 3, "d", 19, "B01")
        OfflineAuthorityVerifier.verify(bundle, expected, java.time.Instant.parse("2025-06-01T00:00:00Z"))
        bundle.getJSONObject("scope").put("deviceId", "attacker")
        var rejected = false
        try { OfflineAuthorityVerifier.verify(bundle, expected, java.time.Instant.parse("2025-06-01T00:00:00Z")) }
        catch (_: IllegalArgumentException) { rejected = true }
        assertTrue(rejected)
    }

    @Test fun derivationIdsAreStableUuidV5() {
        val operation = UUID.fromString("018f47d2-44d2-7a6b-8d7c-8fd8ec6a02cc")
        assertEquals(FiscalCrypto.uuidV5(operation, "receipt"), FiscalCrypto.uuidV5(operation, "receipt"))
        assertFalse(FiscalCrypto.uuidV5(operation, "receipt") == FiscalCrypto.uuidV5(operation, "issue-reservation"))
    }

    @Test fun completeFursV1GoldenIntermediatesAndAttestationMatch() {
        val v = fursVectors()
        val artifact = v.getJSONObject("fursArtifact")
        val intermediates = v.getJSONObject("intermediateHashes")
        val canonicalPayload = FiscalCrypto.canonicalJson(v.getJSONObject("canonicalPayload"))
        assertEquals(v.getString("canonicalPayloadUtf8"), String(canonicalPayload, Charsets.UTF_8))
        assertEquals(v.getString("payloadSha256"), FiscalLedger.sha256(canonicalPayload))
        val plan = FiscalCrypto.canonicalJson(v.getJSONObject("finalizationPlan"))
        assertEquals(v.getString("finalizationPlanCanonicalUtf8"), String(plan, Charsets.UTF_8))
        assertEquals(v.getString("finalizationPlanSha256"), FiscalLedger.sha256(plan))
        assertEquals(v.getString("cashIssueRequestCanonicalSha256"),
            FiscalLedger.sha256(FiscalCrypto.canonicalJson(v.getJSONObject("cashIssueRequest"))))
        assertEquals(intermediates.getString("unsignedInvoiceXmlSha256"),
            FiscalLedger.sha256(artifact.getString("unsignedInvoiceXmlUtf8").toByteArray(Charsets.UTF_8)))
        val signedXml = Base64.getDecoder().decode(artifact.getString("signedXmlBase64"))
        assertEquals("sha256:" + FiscalLedger.sha256(signedXml), artifact.getString("signedXmlSha256"))
        assertEquals(intermediates.getString("signedSoapXmlSha256"), FiscalLedger.sha256(signedXml))
        val zoiSignature = Base64.getDecoder().decode(artifact.getString("zoiSignatureBase64"))
        assertEquals(artifact.getString("zoi"), FiscalCrypto.zoi(zoiSignature))
        assertEquals(intermediates.getString("zoiInputSha256"),
            FiscalLedger.sha256(artifact.getString("zoiInputUtf8").toByteArray(Charsets.UTF_8)))
        assertEquals(intermediates.getString("zoiSignatureSha256"), FiscalLedger.sha256(zoiSignature))
        val message = v.getString("deviceSignatureMessageUtf8").toByteArray(Charsets.UTF_8)
        assertEquals(v.getString("deviceSignatureMessageSha256"), FiscalLedger.sha256(message))
        val authority = v.getJSONObject("testAuthority")
        val der = Base64.getMimeDecoder().decode(authority.getString("publicKeyPem")
            .substringAfter("-----BEGIN PUBLIC KEY-----").substringBefore("-----END PUBLIC KEY-----"))
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
        val provisioning = v.getJSONObject("provisioning")
        val challenge = provisioning.getJSONObject("challenge")
        val proofInput = FiscalCrypto.registrationProofInput(
            challenge.getString("challengeId"),
            challenge.getString("challenge"),
            provisioning.getString("devicePublicKeyPem")
        )
        assertEquals(provisioning.getString("proofSignatureInputUtf8"), proofInput)
        assertEquals(provisioning.getString("devicePublicKeyFingerprintSha256"),
            FiscalLedger.sha256(Base64.getMimeDecoder().decode(
                provisioning.getString("devicePublicKeyPem").substringAfter("-----BEGIN PUBLIC KEY-----")
                    .substringBefore("-----END PUBLIC KEY-----"))))
        assertTrue(Signature.getInstance("SHA256withRSA").run {
            initVerify(publicKey); update(proofInput.toByteArray(Charsets.UTF_8))
            verify(Base64.getDecoder().decode(provisioning.getString("proofSignatureBase64")))
        })
        val signedBundle = provisioning.getJSONObject("signedBundle")
        val unsignedBundle = JSONObject(signedBundle.toString()).apply {
            remove("payloadSha256"); remove("signatureBase64")
        }
        val bundleCanonical = FiscalCrypto.canonicalJson(unsignedBundle)
        assertEquals(provisioning.getString("bundleCanonicalUtf8"), String(bundleCanonical, Charsets.UTF_8))
        assertEquals(signedBundle.getString("payloadSha256"), FiscalLedger.sha256(bundleCanonical))
        assertTrue(Signature.getInstance("SHA256withRSA").run {
            initVerify(publicKey); update(bundleCanonical)
            verify(Base64.getDecoder().decode(signedBundle.getString("signatureBase64")))
        })
        assertTrue(Signature.getInstance("SHA256withRSA").run {
            initVerify(publicKey); update(message)
            verify(Base64.getDecoder().decode(v.getJSONObject("sealedEnvelope").getString("deviceSignature")))
        })
        val dynamic = v.getJSONObject("dynamicFursIds")
        val operation = UUID.fromString(v.getJSONObject("routingFields").getString("operationId"))
        assertEquals(dynamic.getString("messageId"), FiscalCrypto.uuidV5(
            UUID.fromString("7f14bb3e-89d4-5e84-aec8-1ce261acbe10"),
            "furs-v1:invoice-message:$operation"
        ).toString())
        val localReceipt = FiscalCrypto.uuidV5(operation, "receipt").toString()
        assertEquals(dynamic.getString("invoiceRequestId"),
            "InvoiceRequest-${localReceipt.replace("-", "")}-${operation.toString().replace("-", "")}")
        val sync = v.getJSONObject("syncRequestVector")
        assertTrue(Signature.getInstance("SHA256withRSA").run {
            initVerify(publicKey)
            update(sync.getString("signatureInputUtf8").toByteArray(Charsets.UTF_8))
            verify(Base64.getDecoder().decode(sync.getString("signatureBase64")))
        })
        val aggregate = v.getJSONObject("goldenAttestation")
        assertEquals(aggregate.getString("goldenAttestationSha256"),
            FiscalLedger.sha256(aggregate.getString("aggregationInputUtf8").toByteArray(Charsets.UTF_8)))
        assertEquals(v.getString("sealedEnvelopeCanonicalSha256"),
            FiscalLedger.sha256(FiscalCrypto.canonicalJson(v.getJSONObject("sealedEnvelope"))))
    }
}