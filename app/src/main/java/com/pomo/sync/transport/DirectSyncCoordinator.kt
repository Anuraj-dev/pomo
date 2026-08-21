package com.pomo.sync.transport

internal data class SyncEnvelope(
    val operationId: String,
    val feedKey: String,
    val sequence: Long,
    val wire: ByteArray,
)

internal data class DurablePeerFrontier(
    val sequence: Long,
    val operationId: String,
    val coveredOperationIds: Set<String> = emptySet(),
)

internal data class DurablePeerAck(
    val peerDeviceId: String,
    val frontier: Map<String, DurablePeerFrontier>,
    val signatureVerified: Boolean,
)

internal enum class DirectRouteState {
    OFFLINE,
    CATCHING_UP,
    LIVE,
}

internal class DirectSyncCoordinator(
    obligations: Collection<SyncEnvelope>,
) {
    private val pending = obligations.associateByTo(linkedMapOf()) { it.operationId }
    var state: DirectRouteState = DirectRouteState.OFFLINE
        private set

    fun connected() {
        state = DirectRouteState.CATCHING_UP
    }

    fun disconnected() {
        state = DirectRouteState.OFFLINE
    }

    fun nextBatch(limit: Int = MAX_BATCH): List<SyncEnvelope> {
        require(limit in 1..MAX_BATCH)
        return pending.values
            .sortedWith(compareBy<SyncEnvelope> { it.feedKey }.thenBy { it.sequence })
            .take(limit)
    }

    fun ingest(
        envelopes: Collection<SyncEnvelope>,
        kernelIngest: (ByteArray) -> Unit,
    ) {
        envelopes.distinctBy { it.operationId }.forEach { kernelIngest(it.wire.copyOf()) }
    }

    fun acknowledge(
        ack: DurablePeerAck,
    ) {
        require(ack.signatureVerified) { "Only signed durable acknowledgments clear obligations" }
        pending.entries.removeIf { (_, envelope) ->
            val head = ack.frontier[envelope.feedKey]
            val exact = head != null &&
                head.sequence == envelope.sequence && head.operationId == envelope.operationId
            val covered = head != null &&
                head.sequence >= envelope.sequence && envelope.operationId in head.coveredOperationIds
            exact || covered
        }
        if (pending.isEmpty()) state = DirectRouteState.LIVE
    }

    fun liveObservationTrusted(): Boolean = state == DirectRouteState.LIVE
    fun pendingOperationIds(): Set<String> = pending.keys.toSet()

    companion object {
        const val MAX_BATCH: Int = 256
    }
}
