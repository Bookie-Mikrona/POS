package si.bookie.fiscal

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import org.junit.Assert.assertTrue

class DeviceSyncAuthGoldenTest {
    @Test fun matchesServerVerifierGoldenVector() {
        val root = JSONObject(java.io.File(
            "../../../fiscal-service/contract/golden-vectors-furs-v1.json").readText())
        val vector = root.getJSONObject("syncRequestVector")
        assertEquals(vector.getString("timestamp"),
            DeviceSyncAuth.timestamp(Instant.parse(vector.getString("timestamp"))))
        assertEquals(vector.getString("signatureInputUtf8"), DeviceSyncAuth.signatureInput(
            vector.getString("method"), vector.getString("path"), vector.getString("timestamp"),
            vector.getString("nonce"), vector.getString("bodySha256")))
        val pem = root.getJSONObject("provisioning").getString("devicePublicKeyPem")
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(
            Base64.getMimeDecoder().decode(pem.substringAfter("-----BEGIN PUBLIC KEY-----")
                .substringBefore("-----END PUBLIC KEY-----"))))
        assertTrue(Signature.getInstance("SHA256withRSA").run {
            initVerify(publicKey)
            update(vector.getString("signatureInputUtf8").toByteArray(Charsets.UTF_8))
            verify(Base64.getDecoder().decode(vector.getString("signatureBase64")))
        })
    }
}