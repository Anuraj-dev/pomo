package com.pomo.sync.transport

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class DirectSyncCoordinatorTest {
    @Test
    public fun catchUpIsBoundedResumableAndSignedAckCovered() {
        val obligations = (1..300).map { SyncEnvelope("op-$it", "feed", it.toLong(), byteArrayOf(it.toByte())) }
        val coordinator = DirectSyncCoordinator(obligations)
        coordinator.connected()
        assertEquals(256, coordinator.nextBatch().size)
        assertFalse(coordinator.liveObservationTrusted())
        assertTrue(
            runCatching {
                coordinator.acknowledge(
                    DurablePeerAck("peer", mapOf("feed" to DurablePeerFrontier(256, "op-256")), false),
                )
            }.isFailure,
        )
        coordinator.acknowledge(DurablePeerAck("peer", mapOf("feed" to DurablePeerFrontier(256, "wrong-256")), true))
        assertTrue("op-256" in coordinator.pendingOperationIds())
        coordinator.acknowledge(
            DurablePeerAck(
                "peer",
                mapOf("feed" to DurablePeerFrontier(256, "op-256", (1..256).map { "op-$it" }.toSet())),
                true,
            ),
        )
        coordinator.disconnected()
        coordinator.connected()
        assertEquals(44, coordinator.nextBatch().size)
        coordinator.acknowledge(
            DurablePeerAck(
                "peer",
                mapOf("feed" to DurablePeerFrontier(300, "op-300", (257..300).map { "op-$it" }.toSet())),
                true,
            ),
        )
        assertTrue(coordinator.liveObservationTrusted())
    }

    @Test
    public fun duplicateTransferHasOneKernelIngressEffect() {
        val envelope = SyncEnvelope("op", "feed", 1, byteArrayOf(1))
        var ingested = 0
        DirectSyncCoordinator(emptyList()).ingest(listOf(envelope, envelope)) { ingested += 1 }
        assertEquals(1, ingested)
    }
}
