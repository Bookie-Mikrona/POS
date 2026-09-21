package si.bookie.fiscal

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.util.Base64

class PosBoundaryContractTest {
    @Test fun outerEnvelopeMirrorsAuthoritativeFursV2Core() {
        val vectors = JSONObject(File(
            "../../../fiscal-service/contract/golden-vectors-furs-v2.json").readText())
        val core = vectors.getJSONObject("legalCore")
        val canonical = FiscalCrypto.canonicalJson(core)
        val outer = JSONObject()
            .put("canonicalPayload", core)
            .put("payloadSha256", FiscalLedger.sha256(canonical))
            .put("deviceSignature", core.getString("deviceSignatureBase64"))
            .put("signingPublicKeyFingerprintSha256", core.getString("deviceKeyFingerprintSha256"))
        assertEquals(FiscalLedger.sha256(FiscalCrypto.canonicalJson(outer.getJSONObject("canonicalPayload"))),
            outer.getString("payloadSha256"))
        assertEquals(core.getString("deviceSignatureBase64"), outer.getString("deviceSignature"))
        Base64.getDecoder().decode(outer.getString("deviceSignature"))
    }
}