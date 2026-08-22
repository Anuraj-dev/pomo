package com.pomo.sync.transport

import com.pomo.sync.persistence.SyncOperationEntity
import com.pomo.sync.persistence.SyncOutboxEntity
import com.pomo.sync.persistence.SyncRestartSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class OrdinaryDrainHostTest {
    @Test
    public fun emptyRoutesLeaveOutboxAndStayLocalOnly() {
        val obligations = envelopes(3)
        val delivered = mutableListOf<String>()
        val result =
            OrdinaryDrainHost(emptyList(), { }, delivered::add).drain(obligations)
        assertTrue(result.localOnly)
        assertTrue(result.delivered.isEmpty())
        assertEquals(setOf("op-1", "op-2", "op-3"), result.remaining)
        assertTrue(delivered.isEmpty())
        assertFalse(result.live)
    }

    @Test
    public fun signedLoopbackAckClearsCoveredOutboxAndPersistsDelivery() {
        val obligations = envelopes(3)
        val delivered = mutableListOf<String>()
        var ingested = 0
        val result =
            OrdinaryDrainHost(listOf(LoopbackRoute()), { ingested += 1 }, delivered::add).drain(obligations)
        assertFalse(result.localOnly)
        assertEquals(setOf("op-1", "op-2", "op-3"), result.delivered)
        assertTrue(result.remaining.isEmpty())
        assertEquals(listOf("op-1", "op-2", "op-3"), delivered)
        assertEquals(0, ingested)
        assertTrue(result.live)
    }

    @Test
    public fun unsignedAckDoesNotClearObligations() {
        val obligations = envelopes(2)
        val delivered = mutableListOf<String>()
        val result =
            OrdinaryDrainHost(listOf(UnsignedAckRoute()), { }, delivered::add).drain(obligations)
        assertTrue(delivered.isEmpty())
        assertEquals(setOf("op-1", "op-2"), result.remaining)
        assertFalse(result.live)
    }

    @Test
    public fun oneDrainOffersAtMostTheCatchUpBound() {
        val obligations = envelopes(300)
        val offered = mutableListOf<Int>()
        val route =
            object : DrainRoute {
                override val name: String = "probe"

                override fun exchange(batch: List<SyncEnvelope>): DrainExchange {
                    offered += batch.size
                    return DrainExchange(connected = true)
                }
            }
        OrdinaryDrainHost(listOf(route), { }, { }).drain(obligations)
        assertEquals(listOf(256), offered)
    }

    @Test
    public fun outboxWithoutAnOperationDoesNotBecomeAnEnvelope() {
        val snapshot =
            SyncRestartSnapshot(
                operations = emptyList(),
                heads = emptyList(),
                projection = emptyList(),
                pendingOutbox = listOf(SyncOutboxEntity("aa".repeat(32), byteArrayOf(1))),
                dispositionCounts = emptyMap(),
            )
        assertTrue(OrdinaryDrainHost.envelopesFrom(snapshot).isEmpty())
    }

    @Test
    public fun restartSnapshotJoinsOutboxToFeedSequence() {
        val operationId = "ab".repeat(32)
        val snapshot =
            SyncRestartSnapshot(
                operations =
                    listOf(
                        SyncOperationEntity(
                            operationId = operationId,
                            memberId = "member",
                            deviceId = "device",
                            incarnationId = "incarnation",
                            sequence = 7,
                            previousOperationId = null,
                            signedWire = byteArrayOf(2),
                            preferenceKey = "timer.sound",
                            preferenceValue = "bell",
                            disposition = "ACCEPTED",
                            localAuthor = true,
                        ),
                    ),
                heads = emptyList(),
                projection = emptyList(),
                pendingOutbox = listOf(SyncOutboxEntity(operationId, byteArrayOf(2))),
                dispositionCounts = emptyMap(),
            )
        val envelope = OrdinaryDrainHost.envelopesFrom(snapshot).single()
        assertEquals(operationId, envelope.operationId)
        assertEquals("device:incarnation", envelope.feedKey)
        assertEquals(7L, envelope.sequence)
    }

    @Test
    public fun failingRouteDoesNotDropOutbox() {
        val obligations = envelopes(1)
        val delivered = mutableListOf<String>()
        val route =
            object : DrainRoute {
                override val name: String = "down"

                override fun exchange(batch: List<SyncEnvelope>): DrainExchange = error("radio lost")
            }
        val result = OrdinaryDrainHost(listOf(route), { }, delivered::add).drain(obligations)
        assertTrue(delivered.isEmpty())
        assertEquals(setOf("op-1"), result.remaining)
    }

    private fun envelopes(count: Int): List<SyncEnvelope> =
        (1..count).map { index ->
            SyncEnvelope("op-$index", "feed", index.toLong(), byteArrayOf(index.toByte()))
        }

    private class LoopbackRoute : DrainRoute {
        override val name: String = "loopback"

        override fun exchange(batch: List<SyncEnvelope>): DrainExchange {
            if (batch.isEmpty()) return DrainExchange(connected = true)
            val frontier =
                batch.groupBy { it.feedKey }.mapValues { (_, envelopes) ->
                    val head = envelopes.maxBy { it.sequence }
                    DurablePeerFrontier(
                        head.sequence,
                        head.operationId,
                        envelopes.map { it.operationId }.toSet(),
                    )
                }
            return DrainExchange(
                ack = DurablePeerAck("loopback", frontier, true),
                connected = true,
            )
        }
    }

    private class UnsignedAckRoute : DrainRoute {
        override val name: String = "forged"

        override fun exchange(batch: List<SyncEnvelope>): DrainExchange {
            val head = batch.last()
            return DrainExchange(
                ack =
                    DurablePeerAck(
                        "forged",
                        mapOf(head.feedKey to DurablePeerFrontier(head.sequence, head.operationId)),
                        false,
                    ),
                connected = true,
            )
        }
    }
}
