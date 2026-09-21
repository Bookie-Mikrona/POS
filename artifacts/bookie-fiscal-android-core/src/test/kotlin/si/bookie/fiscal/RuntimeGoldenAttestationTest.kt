package si.bookie.fiscal

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.security.cert.CertificateFactory

class RuntimeGoldenAttestationTest {
    private val contract = File("../../../fiscal-service/contract")
    private fun vectors() = JSONObject(File(contract, "golden-vectors-furs-v2.json").readText())
    private fun certificate() = File(contract, "test-fixtures/FURS-V1-GOLDEN-TEST-ONLY-certificate.pem")
        .inputStream().use { CertificateFactory.getInstance("X.509").generateCertificate(it) as java.security.cert.X509Certificate }

    @Test fun executesFursV2LegalCoreAndZoiVector() = assertEquals(
        vectors().getJSONObject("goldenAttestation").getString("goldenAttestationSha256"),
        RuntimeGoldenAttestation.verify(vectors(), certificate()))

    @Test fun corruptLegalCoreBlocksAttestation() {
        val corrupt = vectors()
        corrupt.getJSONObject("legalCore").getJSONObject("legalInvoice").put("zoi", "0".repeat(32))
        assertThrows(IllegalStateException::class.java) { RuntimeGoldenAttestation.verify(corrupt, certificate()) }
    }
}