package si.bookie.fiscal

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.UUID

/** Cross-platform primitives defined by bookie-fiscal-service-v1 golden vectors. */
object FiscalCrypto {
    fun registrationProofInput(challengeId: String, challenge: String, normalizedSpkiPem: String): String {
        UUID.fromString(challengeId)
        require(challenge.isNotEmpty()) { "Challenge must not be empty" }
        require(normalizedSpkiPem.endsWith("\n")) { "SPKI PEM must be normalized and LF-terminated" }
        val fingerprint = FiscalLedger.sha256(Base64.getMimeDecoder().decode(
            normalizedSpkiPem.substringAfter("-----BEGIN PUBLIC KEY-----")
                .substringBefore("-----END PUBLIC KEY-----")))
        return "bookie-device-registration-v1\n$challengeId\n$challenge\n$fingerprint"
    }

    private val ljubljana = ZoneId.of("Europe/Ljubljana")
    private val zoiTime = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm:ss")

    fun canonicalJson(value: Any?): ByteArray =
        StringBuilder().also { appendCanonical(it, value) }.toString().toByteArray(StandardCharsets.UTF_8)

    fun zoiInput(
        taxNumber: String,
        legalTimestamp: String,
        sequence: Long,
        premiseLabel: String,
        bIdentifier: String,
        gross: String,
    ): ByteArray {
        require(taxNumber.matches(Regex("[0-9]{8}")))
        val timestamp = OffsetDateTime.parse(legalTimestamp)
        require(!legalTimestamp.endsWith("Z")) { "Europe/Ljubljana offset is required" }
        val amount = BigDecimal(gross).setScale(2).toPlainString()
        return "$taxNumber${timestamp.atZoneSameInstant(ljubljana).format(zoiTime)}$sequence$premiseLabel$bIdentifier$amount"
            .toByteArray(StandardCharsets.UTF_8)
    }

    fun rsaSha256(privateKey: PrivateKey, message: ByteArray): ByteArray =
        Signature.getInstance("SHA256withRSA").run { initSign(privateKey); update(message); sign() }

    fun zoi(signature: ByteArray): String =
        MessageDigest.getInstance("MD5").digest(signature).joinToString("") { "%02x".format(it) }

    fun signatureBase64(privateKey: PrivateKey, canonicalMessage: ByteArray): String =
        Base64.getEncoder().encodeToString(rsaSha256(privateKey, canonicalMessage))

    fun uuidV5(namespace: UUID, name: String): UUID {
        val ns = java.nio.ByteBuffer.allocate(16).putLong(namespace.mostSignificantBits)
            .putLong(namespace.leastSignificantBits).array()
        val digest = MessageDigest.getInstance("SHA-1").digest(ns + name.toByteArray(StandardCharsets.UTF_8))
        digest[6] = ((digest[6].toInt() and 0x0f) or 0x50).toByte()
        digest[8] = ((digest[8].toInt() and 0x3f) or 0x80).toByte()
        val bytes = java.nio.ByteBuffer.wrap(digest)
        return UUID(bytes.long, bytes.long)
    }

    private fun appendCanonical(out: StringBuilder, value: Any?) {
        when (value) {
            null, JSONObject.NULL -> out.append("null")
            is String -> appendString(out, value)
            is Boolean -> out.append(if (value) "true" else "false")
            is Byte, is Short, is Int, is Long -> out.append(value)
            is Float -> appendFiniteNumber(out, value.toDouble())
            is Double -> appendFiniteNumber(out, value)
            is BigDecimal -> {
                require(value.signum() != 0 || value.toString() != "-0") { "Negative zero is forbidden" }
                out.append(value.stripTrailingZeros().toPlainString())
            }
            is JSONObject -> {
                out.append('{')
                val keys = value.keys().asSequence().toList().sortedWith(Comparator(::compareCodePoints))
                keys.forEachIndexed { index, key ->
                    if (index > 0) out.append(',')
                    appendString(out, key); out.append(':'); appendCanonical(out, value.get(key))
                }
                out.append('}')
            }
            is JSONArray -> {
                out.append('[')
                for (i in 0 until value.length()) {
                    if (i > 0) out.append(',')
                    appendCanonical(out, value.get(i))
                }
                out.append(']')
            }
            else -> throw IllegalArgumentException("Unsupported canonical JSON value ${value.javaClass.name}")
        }
    }

    private fun compareCodePoints(a: String, b: String): Int {
        val aa = a.codePoints().toArray()
        val bb = b.codePoints().toArray()
        for (i in 0 until minOf(aa.size, bb.size)) if (aa[i] != bb[i]) return aa[i].compareTo(bb[i])
        return aa.size.compareTo(bb.size)
    }

    private fun appendString(out: StringBuilder, text: String) {
        out.append('"')
        text.forEach { ch ->
            when (ch) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\b' -> out.append("\\b")
                '\u000c' -> out.append("\\f")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                else -> if (ch.code < 0x20) out.append("\\u%04x".format(ch.code)) else out.append(ch)
            }
        }
        out.append('"')
    }

    private fun appendFiniteNumber(out: StringBuilder, number: Double) {
        require(number.isFinite()) { "Non-finite JSON number" }
        require(java.lang.Double.doubleToRawLongBits(number) != java.lang.Double.doubleToRawLongBits(-0.0)) {
            "Negative zero is forbidden"
        }
        out.append(BigDecimal(number.toString()).stripTrailingZeros().toPlainString())
    }
}