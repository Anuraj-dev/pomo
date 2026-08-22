package com.pomo.sync.transport

import com.pomo.sync.persistence.SyncRestartSnapshot

internal data class DrainExchange(
    val inbound: List<SyncEnvelope> = emptyList(),
    val ack: DurablePeerAck? = null,
    val connected: Boolean = false,
)

internal interface DrainRoute {
    val name: String

    fun exchange(batch: List<SyncEnvelope>): DrainExchange
}

internal data class DrainResult(
    val delivered: Set<String>,
    val remaining: Set<String>,
    val inbound: Int,
    val localOnly: Boolean,
    val live: Boolean,
)

/**
 * Bounded ordinary drain. Walks the durable outbox once, offers at most one
 * [DirectSyncCoordinator.MAX_BATCH] to each route, and clears an obligation only
 * after a signed durable ack is persisted.
 */
internal class OrdinaryDrainHost(
    private val routes: List<DrainRoute>,
    private val ingest: (ByteArray) -> Unit,
    private val markDelivered: (String) -> Unit,
) {
    fun drain(obligations: List<SyncEnvelope>): DrainResult {
        val coordinator = DirectSyncCoordinator(obligations)
        if (routes.isEmpty()) {
            return DrainResult(
                delivered = emptySet(),
                remaining = coordinator.pendingOperationIds(),
                inbound = 0,
                localOnly = true,
                live = false,
            )
        }
        val delivered = linkedSetOf<String>()
        var inboundCount = 0
        var anyConnected = false
        for (route in routes) {
            val batch = coordinator.nextBatch()
            val exchange =
                try {
                    route.exchange(batch)
                } catch (_: Exception) {
                    continue
                }
            if (exchange.connected) {
                coordinator.connected()
                anyConnected = true
            }
            try {
                coordinator.ingest(exchange.inbound, ingest)
                inboundCount += exchange.inbound.distinctBy { it.operationId }.size
            } catch (_: Exception) {
                continue
            }
            val ack = exchange.ack ?: continue
            val before = coordinator.pendingOperationIds()
            try {
                coordinator.acknowledge(ack)
            } catch (_: Exception) {
                continue
            }
            (before - coordinator.pendingOperationIds()).forEach { operationId ->
                markDelivered(operationId)
                delivered += operationId
            }
        }
        if (!anyConnected) coordinator.disconnected()
        return DrainResult(
            delivered = delivered,
            remaining = coordinator.pendingOperationIds(),
            inbound = inboundCount,
            localOnly = !anyConnected,
            live = coordinator.liveObservationTrusted(),
        )
    }

    companion object {
        fun envelopesFrom(snapshot: SyncRestartSnapshot): List<SyncEnvelope> {
            val byId = snapshot.operations.associateBy { it.operationId }
            return snapshot.pendingOutbox.mapNotNull { outbox ->
                val operation = byId[outbox.operationId] ?: return@mapNotNull null
                SyncEnvelope(
                    operation.operationId,
                    "${operation.deviceId}:${operation.incarnationId}",
                    operation.sequence,
                    outbox.signedWire.copyOf(),
                )
            }
        }
    }
}
