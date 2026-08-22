package com.pomo.sync.transport

import com.pomo.sync.protocol.IngestDisposition

/**
 * Shared immutable WebDAV mailbox as an ordinary drain route. Operation
 * objects are protected immutably. Offer and ack locators are overwriteable
 * pointers so peers can find the latest batch without PROPFIND.
 */
internal class WebDavMailboxSession(
    val deviceId: String,
    val publicKey: ByteArray,
    private val mailboxId: String,
    private val client: ImmutableMailboxClient,
    private val peerDeviceIds: List<String>,
    private val sign: (ByteArray) -> ByteArray,
    private val ingest: (ByteArray) -> String,
) {
    private val mailbox = WebDavMailbox(mailboxId, client)

    fun drainRoute(): DrainRoute =
        object : DrainRoute {
            override val name: String = "mailbox:$mailboxId"

            override fun exchange(batch: List<SyncEnvelope>): DrainExchange {
                val objects = WebDavMailboxCodec.mailboxObjects(batch)
                val protection = mailbox.protect(objects)
                if (!protection.protected) {
                    return DrainExchange(connected = false)
                }
                if (batch.isNotEmpty()) {
                    client.put(WebDavMailboxCodec.offerLocator(deviceId), WebDavMailboxCodec.encodeOffer(deviceId, batch))
                }
                val inbound = linkedMapOf<String, SyncEnvelope>()
                for (peerId in peerDeviceIds) {
                    if (peerId == deviceId) continue
                    val offerBytes = client.get(WebDavMailboxCodec.offerLocator(peerId)) ?: continue
                    val (_, entries) = WebDavMailboxCodec.decodeOffer(offerBytes)
                    val accepted = mutableListOf<SyncEnvelope>()
                    val covered = linkedSetOf<String>()
                    for ((meta, objectId) in entries) {
                        val wire = client.get(objectId) ?: continue
                        val envelope = SyncEnvelope(meta.operationId, meta.feedKey, meta.sequence, wire.copyOf())
                        val disposition = ingest(wire.copyOf())
                        if (disposition in DURABLE) {
                            covered += meta.operationId
                            accepted += envelope
                        }
                        inbound[meta.operationId] = envelope
                    }
                    if (covered.isNotEmpty()) {
                        client.put(
                            WebDavMailboxCodec.ackLocator(peerId),
                            WebDavMailboxCodec.encodeAckObject(signAck(accepted, covered)),
                        )
                    }
                }
                val ackBytes = client.get(WebDavMailboxCodec.ackLocator(deviceId))
                val ack =
                    ackBytes?.let {
                        runCatching { ReplicaLanSession.verifyAck(WebDavMailboxCodec.decodeAckObject(it)) }.getOrNull()
                    }
                return DrainExchange(
                    inbound = inbound.values.toList(),
                    ack = ack,
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

    private companion object {
        val DURABLE =
            setOf(
                IngestDisposition.ACCEPTED.name,
                IngestDisposition.DUPLICATE.name,
                IngestDisposition.PENDING_GAP.name,
                IngestDisposition.PENDING_CAUSAL.name,
                IngestDisposition.QUARANTINED_FORK.name,
            )
    }
}
