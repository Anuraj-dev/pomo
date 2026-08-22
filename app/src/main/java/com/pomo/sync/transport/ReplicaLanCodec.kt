package com.pomo.sync.transport

import com.pomo.sync.protocol.CborValue
import com.pomo.sync.protocol.DeterministicCbor

internal data class ReplicaLanRequest(
    val deviceId: String,
    val envelopes: List<SyncEnvelope>,
)

internal data class ReplicaLanAck(
    val peerDeviceId: String,
    val publicKey: ByteArray,
    val frontier: Map<String, DurablePeerFrontier>,
    val signature: ByteArray,
)

internal data class ReplicaLanResponse(
    val deviceId: String,
    val inbound: List<SyncEnvelope>,
    val ack: ReplicaLanAck,
)

internal object ReplicaLanCodec {
    const val REQUEST_LABEL: String = "pomo-replica-lan-request"
    const val RESPONSE_LABEL: String = "pomo-replica-lan-response"
    const val ACK_LABEL: String = "pomo-durable-peer-ack"
    const val SCHEMA: Long = 1
    const val MAX_FRAME_BYTES: Int = 1_048_576

    fun encodeRequest(request: ReplicaLanRequest): ByteArray =
        DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Text(REQUEST_LABEL),
                    CborValue.Integer(SCHEMA),
                    CborValue.Text(request.deviceId),
                    encodeEnvelopes(request.envelopes),
                ),
            ),
        )

    fun decodeRequest(bytes: ByteArray): ReplicaLanRequest {
        val fields = frame(bytes, 4, REQUEST_LABEL)
        return ReplicaLanRequest(text(fields[2], "deviceId"), decodeEnvelopes(fields[3]))
    }

    fun encodeAckBody(
        peerDeviceId: String,
        publicKey: ByteArray,
        frontier: Map<String, DurablePeerFrontier>,
    ): ByteArray =
        DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Text(ACK_LABEL),
                    CborValue.Integer(SCHEMA),
                    CborValue.Text(peerDeviceId),
                    CborValue.Bytes(publicKey.copyOf()),
                    encodeFrontier(frontier),
                ),
            ),
        )

    fun encodeResponse(response: ReplicaLanResponse): ByteArray =
        DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Text(RESPONSE_LABEL),
                    CborValue.Integer(SCHEMA),
                    CborValue.Text(response.deviceId),
                    encodeEnvelopes(response.inbound),
                    CborValue.Bytes(encodeAckBody(response.ack.peerDeviceId, response.ack.publicKey, response.ack.frontier)),
                    CborValue.Bytes(response.ack.signature.copyOf()),
                ),
            ),
        )

    fun decodeResponse(bytes: ByteArray): ReplicaLanResponse {
        val fields = frame(bytes, 6, RESPONSE_LABEL)
        val ackBody = (fields[4] as? CborValue.Bytes)?.value ?: error("ack body must be a byte string")
        val signature = (fields[5] as? CborValue.Bytes)?.value ?: error("ack signature must be a byte string")
        val ackFields = frame(ackBody, 5, ACK_LABEL)
        val publicKey = (ackFields[3] as? CborValue.Bytes)?.value ?: error("ack public key must be a byte string")
        return ReplicaLanResponse(
            text(fields[2], "deviceId"),
            decodeEnvelopes(fields[3]),
            ReplicaLanAck(
                text(ackFields[2], "peerDeviceId"),
                publicKey.copyOf(),
                decodeFrontier(ackFields[4]),
                signature.copyOf(),
            ),
        )
    }

    private fun encodeEnvelopes(envelopes: List<SyncEnvelope>): CborValue.Array =
        CborValue.Array(
            envelopes.map { envelope ->
                CborValue.Array(
                    listOf(
                        CborValue.Text(envelope.operationId),
                        CborValue.Text(envelope.feedKey),
                        CborValue.Integer(envelope.sequence),
                        CborValue.Bytes(envelope.wire.copyOf()),
                    ),
                )
            },
        )

    private fun decodeEnvelopes(value: CborValue): List<SyncEnvelope> {
        val items = (value as? CborValue.Array)?.values ?: error("envelopes must be an array")
        return items.map { item ->
            val fields = (item as? CborValue.Array)?.values ?: error("envelope must be an array")
            require(fields.size == 4) { "envelope must have four fields" }
            val wire = (fields[3] as? CborValue.Bytes)?.value ?: error("envelope wire must be a byte string")
            SyncEnvelope(
                text(fields[0], "operationId"),
                text(fields[1], "feedKey"),
                integer(fields[2], "sequence"),
                wire.copyOf(),
            )
        }
    }

    private fun encodeFrontier(frontier: Map<String, DurablePeerFrontier>): CborValue.Array =
        CborValue.Array(
            frontier.entries.sortedBy { it.key }.map { (feedKey, head) ->
                CborValue.Array(
                    listOf(
                        CborValue.Text(feedKey),
                        CborValue.Integer(head.sequence),
                        CborValue.Text(head.operationId),
                        CborValue.Array(head.coveredOperationIds.sorted().map { CborValue.Text(it) }),
                    ),
                )
            },
        )

    private fun decodeFrontier(value: CborValue): Map<String, DurablePeerFrontier> {
        val items = (value as? CborValue.Array)?.values ?: error("frontier must be an array")
        return items.associate { item ->
            val fields = (item as? CborValue.Array)?.values ?: error("frontier entry must be an array")
            require(fields.size == 4) { "frontier entry must have four fields" }
            val covered =
                ((fields[3] as? CborValue.Array)?.values ?: error("covered ids must be an array"))
                    .map { text(it, "coveredOperationId") }
                    .toSet()
            text(fields[0], "feedKey") to
                DurablePeerFrontier(
                    integer(fields[1], "sequence"),
                    text(fields[2], "operationId"),
                    covered,
                )
        }
    }

    private fun frame(
        bytes: ByteArray,
        size: Int,
        label: String,
    ): List<CborValue> {
        val fields = (DeterministicCbor.decodeCanonical(bytes) as? CborValue.Array)?.values ?: error("replica frame must be an array")
        require(fields.size == size) { "replica frame must have $size fields" }
        require(fields[0] == CborValue.Text(label)) { "unexpected replica frame label" }
        require(fields[1] == CborValue.Integer(SCHEMA)) { "unsupported replica frame schema" }
        return fields
    }

    private fun text(
        value: CborValue,
        name: String,
    ): String = (value as? CborValue.Text)?.value ?: error("$name must be text")

    private fun integer(
        value: CborValue,
        name: String,
    ): Long = (value as? CborValue.Integer)?.value ?: error("$name must be an integer")
}
