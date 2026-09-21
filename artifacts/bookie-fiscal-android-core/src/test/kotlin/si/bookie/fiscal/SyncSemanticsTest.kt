package si.bookie.fiscal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncSemanticsTest {
    @Test fun post500BecomesUnknownThenStatusFound() {
        val ambiguous = SyncSemantics.decide(false, 500)
        assertEquals(SyncSemantics.State.UNKNOWN, ambiguous.state)
        assertTrue(ambiguous.needsStatusCheck)
        assertFalse(ambiguous.retryPost)
        val found = SyncSemantics.decide(true, 200, "confirmed")
        assertEquals(SyncSemantics.State.CONFIRMED, found.state)
    }

    @Test fun timeoutThenAuthenticated404RetriesSameImmutableEnvelope() {
        val sequence = 71L
        val envelopeHash = "abc123"
        assertEquals(SyncSemantics.State.UNKNOWN, SyncSemantics.decide(false, null).state)
        val absent = SyncSemantics.decide(true, 404)
        assertEquals(SyncSemantics.State.PENDING, absent.state)
        assertTrue(absent.retryPost)
        // Transport transitions carry no issuance action or replacement data.
        assertEquals(71L, sequence)
        assertEquals("abc123", envelopeHash)
    }

    @Test fun rateLimitUsesBoundedExponentialBackoff() {
        val limited = SyncSemantics.decide(false, 429)
        assertEquals(SyncSemantics.State.UNKNOWN, limited.state)
        assertEquals(15_000L, SyncSemantics.boundedBackoffMillis(1))
        assertEquals(3_600_000L, SyncSemantics.boundedBackoffMillis(9))
        assertEquals(3_600_000L, SyncSemantics.boundedBackoffMillis(100))
    }

    @Test fun permanentConflictRequiresReviewAndNeverAutoRetries() {
        val conflict = SyncSemantics.decide(false, 409)
        assertEquals(SyncSemantics.State.NEEDS_REVIEW, conflict.state)
        assertFalse(conflict.retryPost)
        assertFalse(conflict.needsStatusCheck)
    }

    @Test fun failedOnlyComesFromExplicitAuthenticatedBusinessState() {
        assertEquals(SyncSemantics.State.NEEDS_REVIEW, SyncSemantics.decide(false, 422).state)
        assertEquals(SyncSemantics.State.FAILED, SyncSemantics.decide(false, 200, "failed").state)
    }
}