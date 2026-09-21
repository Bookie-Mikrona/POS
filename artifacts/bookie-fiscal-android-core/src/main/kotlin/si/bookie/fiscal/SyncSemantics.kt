package si.bookie.fiscal

/** Pure transition table for tests and the WorkManager transport. */
object SyncSemantics {
    enum class State { PENDING, RECEIVED, FINALIZING, CONFIRMED, FAILED, UNKNOWN, NEEDS_REVIEW }
    data class Decision(val state: State, val retryPost: Boolean, val needsStatusCheck: Boolean)

    fun decide(statusCheck: Boolean, httpCode: Int?, serverState: String? = null): Decision {
        if (httpCode == null || httpCode == 408 || httpCode == 429 || (httpCode ?: 0) >= 500)
            return Decision(State.UNKNOWN, false, true)
        if (httpCode in 200..299) {
            val state = when (serverState) {
                "confirmed" -> State.CONFIRMED
                "pending", "sending" -> State.FINALIZING
                "received_pending_review" -> State.RECEIVED
                // FAILED is allowed only when explicitly authenticated as a
                // business/FURS state, never inferred from transport.
                "failed" -> State.FAILED
                "quarantined" -> State.NEEDS_REVIEW
                else -> State.UNKNOWN
            }
            return Decision(state, false, state != State.CONFIRMED)
        }
        if (statusCheck && httpCode == 404)
            return Decision(State.PENDING, true, false)
        return Decision(State.NEEDS_REVIEW, false, false)
    }

    fun boundedBackoffMillis(attempt: Int): Long {
        val exponent = (attempt - 1).coerceIn(0, 8)
        return (15_000L shl exponent).coerceAtMost(60L * 60 * 1000)
    }
}