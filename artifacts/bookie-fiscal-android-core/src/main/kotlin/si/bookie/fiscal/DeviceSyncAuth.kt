package si.bookie.fiscal

import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/** Pure construction shared by runtime and verifier-vector tests. */
object DeviceSyncAuth {
    private val RFC3339_MILLIS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(ZoneOffset.UTC)

    fun timestamp(instant: Instant): String = RFC3339_MILLIS.format(instant)

    fun signatureInput(method: String, pathWithQuery: String, timestamp: String,
                       nonce: String, lowercaseBodySha256: String): String {
        require(pathWithQuery.startsWith("/"))
        require(lowercaseBodySha256.matches(Regex("[0-9a-f]{64}")))
        Instant.parse(timestamp)
        return "${method.uppercase()}\n$pathWithQuery\n$timestamp\n$nonce\n$lowercaseBodySha256"
    }
}