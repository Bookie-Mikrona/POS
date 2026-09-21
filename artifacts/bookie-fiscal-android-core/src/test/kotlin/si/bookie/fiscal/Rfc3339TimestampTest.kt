package si.bookie.fiscal

import org.json.JSONObject
import org.junit.Test

class Rfc3339TimestampTest {
    private fun vectors() = JSONObject(java.io.File(
        "../../../fiscal-service/contract/golden-vectors-furs-v2.json").readText())

    @Test fun acceptsZuluAuthorityValidity() {
        val authority = JSONObject(vectors().getJSONObject("legalCore").getJSONObject("authorityBundle").toString())
        authority.getJSONObject("validity")
            .put("validFrom", "2026-08-31T22:00:00Z")
            .put("validUntil", "2026-09-07T22:00:00Z")
        DynamicFursEngine.parseOfflineAuthorityBundle(authority)
    }

    @Test fun acceptsRfc3339OffsetsNotEqualToLjubljana() {
        val authority = JSONObject(vectors().getJSONObject("legalCore").getJSONObject("authorityBundle").toString())
        authority.getJSONObject("validity").put("validFrom", "2026-08-31T22:00:00Z")
            .put("validUntil", "2026-09-07T22:00:00Z")
        DynamicFursEngine.parseOfflineAuthorityBundle(authority)
    }
}