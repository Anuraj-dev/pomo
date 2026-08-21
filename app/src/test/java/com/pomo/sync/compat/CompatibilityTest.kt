package com.pomo.sync.compat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

public class CompatibilityTest {
    private val baseline = AuthoringBaseline(2, 2, 2, 2, 2, 6)
    private val current =
        CompatibilityProfile("full", setOf(1, 2), setOf(2), setOf(2), setOf(2), setOf(2), setOf(2), 6, true)

    @Test
    public fun deviceReadyRequiresTheCompleteAuthenticatedBaseline() {
        assertEquals(CompatibilityMode.READY, compatibilityMode(current, baseline))
        assertEquals(CompatibilityMode.LIMITED_FORWARD_ONLY, compatibilityMode(current.copy(writableSchemas = emptySet()), baseline))
        assertEquals(CompatibilityMode.BLOCKED_AUTHORITY, compatibilityMode(current.copy(suiteGenerations = setOf(1)), baseline))
    }
    @Test
    public fun readerFirstActivationNeedsIndependentConfirmationAndQuarantinesConcurrency() {
        val proposed = GenerationActivation(2, "frontier", setOf("full"), "full", null, false, emptySet())
        assertEquals(ActivationDecision.PROPOSED, evaluateActivation(proposed, setOf(2)))
        assertEquals(ActivationDecision.CONFIRMED, evaluateActivation(proposed.copy(confirmerDeviceId = "other"), setOf(2)))
        assertEquals(ActivationDecision.QUARANTINED_CONCURRENT, evaluateActivation(proposed, setOf(2, 3)))
        assertTrue(runCatching { evaluateActivation(proposed.copy(readerReadyDeviceIds = emptySet()), setOf(2)) }.isFailure)
    }
    @Test
    public fun oldBuildsAreReadOnlyAndIndependentFactsNeedImport() {
        assertEquals("READ_ONLY", oldBuildDataDisposition(true, false))
        assertEquals("EXPLICIT_IMPORT_REQUIRED", oldBuildDataDisposition(false, true))
    }
}
