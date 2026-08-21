package com.pomo.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class DormantSyncSystemTest {
    @Test
    public fun testArtifactRoutesEveryEnvelopeThroughAuthenticatedKernelIngress() {
        var received: ByteArray? = null
        val system =
            DormantSyncSystem(
                ingress = AuthenticatedOperationIngress { wire -> received = wire; "ACCEPTED" },
                mode = SyncActivationMode(productionActivated = false, testArtifact = true),
            )
        system.startTestArtifact()
        val source = byteArrayOf(1, 2, 3)
        assertEquals("ACCEPTED", system.ingestFromReplica(source))
        source.fill(0)
        assertTrue(received?.contentEquals(byteArrayOf(1, 2, 3)) == true)
        assertFalse(system.productionMigrationCutoverAllowed())
    }

    @Test
    public fun productionCannotStartOrCutOver() {
        val system =
            DormantSyncSystem(
                ingress = AuthenticatedOperationIngress { "ACCEPTED" },
                mode = SyncActivationMode(productionActivated = false, testArtifact = false),
            )
        assertTrue(runCatching { system.startTestArtifact() }.isFailure)
        assertFalse(system.productionMigrationCutoverAllowed())
    }
}
