package si.bookie.fiscal

/**
 * Device-neutral boundary used by the fiscal service. Implementations must
 * synchronously report the hardware result; a successful method return is the
 * durable PRINTED transition boundary.
 */
interface FiscalPrinter {
    val paperWidthMm: Int
    fun isHealthy(): Boolean
    fun status(): String
    fun printLegal(lines: List<String>, qrData: String?, zoi: String?, reprint: Boolean): Result<Unit>
}