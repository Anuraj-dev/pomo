package com.pomo.sync

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class SyncActivationTest {
    @Test
    public fun devArtifactExposesDormantSystemWithoutProductionCutover() {
        assertFalse(syncActivationMode.productionActivated)
        assertTrue(syncActivationMode.testArtifact)
    }
}
