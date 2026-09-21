package si.bookie.fiscal

import android.content.Context
import android.content.pm.ApplicationInfo
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.Base64

/**
 * The only authority trust input accepted by the Android fiscal runtime.
 *
 * Values are generated into resources by Gradle.  In particular, authority
 * material carried inside a provisioning bundle is never used as a trust root.
 */
data class ProductionTrust(
    val keyId: String,
    val publicKeyPem: String,
    val productionReady: Boolean,
) {
    companion object {
        const val TEST_KEY_ID = "FURS-V1-GOLDEN-TEST-ONLY"

        fun load(context: Context): ProductionTrust {
            val debug = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
            fun resource(name: String): String {
                val id = context.resources.getIdentifier(name, "string", context.packageName)
                return if (id == 0) "" else context.getString(id).trim()
            }
            val keyId = resource("bookie_offline_authority_key_id")
            val encoded = resource("bookie_offline_authority_public_key_pem_base64")
            if (keyId.isEmpty() || encoded.isEmpty()) {
                check(debug) { "Missing production offline authority trust anchor" }
                // Golden trust is packaged only for local/debug conformance. It can
                // never make a debuggable application production-ready.
                val golden = context.assets.open("golden-vectors-furs-v2.json").bufferedReader().use {
                    JSONObject(it.readText()).getJSONObject("testAuthority")
                }
                return ProductionTrust(
                    TEST_KEY_ID,
                    golden.getString("publicKeyPem").replace("\r\n", "\n").trim() + "\n",
                    false,
                )
            }
            val pem = try {
                String(Base64.getDecoder().decode(encoded), StandardCharsets.US_ASCII)
                    .replace("\r\n", "\n").trim() + "\n"
            } catch (e: Exception) {
                throw IllegalStateException("Invalid offline authority public key encoding", e)
            }
            check(pem.startsWith("-----BEGIN PUBLIC KEY-----\n") &&
                pem.endsWith("\n-----END PUBLIC KEY-----\n")) { "Invalid offline authority SPKI PEM" }
            check(debug || keyId != TEST_KEY_ID) { "Test authority is forbidden in release builds" }
            return ProductionTrust(keyId, pem, !debug)
        }
    }
}