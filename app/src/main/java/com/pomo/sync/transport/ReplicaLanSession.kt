package com.pomo.sync.transport

import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.protocol.IngestDisposition

internal class ReplicaLanSession(
    val deviceId: String,
    val publicKey: ByteArray,
    private val sign: (ByteArray) -> ByteArray,
    private val ingest: (ByteArray) -> String,
    private val outbox: () -> List<SyncEnvelope>,
) {
    init {
        require(deviceId.isNotEmpty())
        require(publicKey.size == 65 && publicKey[0] == 0x04.toByte())
    }

    fun handle(request: ReplicaLanRequest): ReplicaLanResponse {
        val covered = linkedSetOf<String>()
        request.envelopes.take(DirectSyncCoordinator.MAX_BATCH).forEach { envelope ->
            val disposition = ingest(envelope.wire.copyOf())
            if (disposition in DURABLE) covered += envelope.operationId
        }
        return ReplicaLanResponse(
            deviceId,
            outbox().take(DirectSyncCoordinator.MAX_BATCH),
            signAck(request.envelopes, covered),
        )
    }

    fun drainRoute(
        peerDeviceId: String,
        exchange: (ReplicaLanRequest) -> ReplicaLanResponse,
    ): DrainRoute =
        object : DrainRoute {
            override val name: String = "lan:$peerDeviceId"

            override fun exchange(batch: List<SyncEnvelope>): DrainExchange {
                val response = exchange(ReplicaLanRequest(deviceId, batch))
                return DrainExchange(
                    inbound = response.inbound,
                    ack = verifyAck(response.ack),
                    connected = true,
                )
            }
        }

    private fun signAck(
        batch: List<SyncEnvelope>,
        covered: Set<String>,
    ): ReplicaLanAck {
        val frontier =
            batch
                .filter { it.operationId in covered }
                .groupBy { it.feedKey }
                .mapValues { (_, envelopes) ->
                    val head = envelopes.maxBy { it.sequence }
                    DurablePeerFrontier(
                        head.sequence,
                        head.operationId,
                        envelopes.map { it.operationId }.toSet(),
                    )
                }
        val body = ReplicaLanCodec.encodeAckBody(deviceId, publicKey, frontier)
        return ReplicaLanAck(deviceId, publicKey.copyOf(), frontier, sign(body))
    }

    companion object {
        private val DURABLE =
            setOf(
                IngestDisposition.ACCEPTED.name,
                IngestDisposition.DUPLICATE.name,
                IngestDisposition.PENDING_GAP.name,
                IngestDisposition.PENDING_CAUSAL.name,
                IngestDisposition.QUARANTINED_FORK.name,
            )

        fun verifyAck(ack: ReplicaLanAck): DurablePeerAck {
            val canonical = ReplicaLanCodec.encodeAckBody(ack.peerDeviceId, ack.publicKey, ack.frontier)
            val verified =
                runCatching {
                    PomoCrypto.verifyP256LowS(
                        HpkeP256.publicKeyFromUncompressed(ack.publicKey),
                        canonical,
                        ack.signature,
                    )
                }.isSuccess
            return DurablePeerAck(ack.peerDeviceId, ack.frontier, verified)
        }
    }
}
