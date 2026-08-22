package com.pomo.sync.transport

import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.protocol.CborValue
import com.pomo.sync.protocol.DeterministicCbor

internal object WebDavMailboxCodec {
    const val OFFER_LABEL: String = "pomo-mailbox-offer"
    const val ACK_OBJECT_LABEL: String = "pomo-mailbox-ack"
    const val SCHEMA: Long = 1

    fun objectIdForWire(wire: ByteArray): String = PomoCrypto.sha256(wire).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    fun offerLocator(deviceId: String): String = "locator-offer-$deviceId"

    fun ackLocator(targetDeviceId: String): String = "locator-ack-$targetDeviceId"

    fun mailboxObjects(batch: List<SyncEnvelope>): List<MailboxObject> =
        batch.map { envelope ->
            val wire = ProviderWrap.wrap(envelope.wire)
            MailboxObject(
                objectIdForWire(wire),
                wire,
                PomoCrypto.sha256(wire).joinToString("") { "%02x".format(it.toInt() and 0xff) },
                wire.size.toLong(),
            )
        }

    fun encodeOffer(
        deviceId: String,
        envelopes: List<SyncEnvelope>,
        objects: List<MailboxObject>,
    ): ByteArray {
        require(envelopes.size == objects.size)
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Text(OFFER_LABEL),
                    CborValue.Integer(SCHEMA),
                    CborValue.Text(deviceId),
                    CborValue.Array(
                        envelopes.mapIndexed { index, envelope ->
                            CborValue.Array(
                                listOf(
                                    CborValue.Text(envelope.operationId),
                                    CborValue.Text(envelope.feedKey),
                                    CborValue.Integer(envelope.sequence),
                                    CborValue.Text(objects[index].objectId),
                                ),
                            )
                        },
                    ),
                ),
            ),
        )
    }

    fun decodeOffer(bytes: ByteArray): Pair<String, List<Pair<SyncEnvelope, String>>> {
        val fields = frame(bytes, 4, OFFER_LABEL)
        val deviceId = text(fields[2], "deviceId")
        val items = (fields[3] as? CborValue.Array)?.values ?: error("offer entries must be an array")
        val entries =
            items.map { item ->
                val entry = (item as? CborValue.Array)?.values ?: error("offer entry must be an array")
                require(entry.size == 4) { "offer entry must have four fields" }
                val objectId = text(entry[3], "objectId")
                SyncEnvelope(
                    text(entry[0], "operationId"),
                    text(entry[1], "feedKey"),
                    integer(entry[2], "sequence"),
                    ByteArray(0),
                ) to objectId
            }
        return deviceId to entries
    }

    fun encodeAckObject(ack: ReplicaLanAck): ByteArray {
        val body = ReplicaLanCodec.encodeAckBody(ack.peerDeviceId, ack.publicKey, ack.frontier)
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Text(ACK_OBJECT_LABEL),
                    CborValue.Integer(SCHEMA),
                    CborValue.Bytes(body),
                    CborValue.Bytes(ack.signature.copyOf()),
                ),
            ),
        )
    }

    fun decodeAckObject(bytes: ByteArray): ReplicaLanAck {
        val fields = frame(bytes, 4, ACK_OBJECT_LABEL)
        val body = (fields[2] as? CborValue.Bytes)?.value ?: error("ack body must be a byte string")
        val signature = (fields[3] as? CborValue.Bytes)?.value ?: error("ack signature must be a byte string")
        val ackFields = frame(body, 5, ReplicaLanCodec.ACK_LABEL)
        val publicKey = (ackFields[3] as? CborValue.Bytes)?.value ?: error("ack public key must be a byte string")
        return ReplicaLanAck(
            text(ackFields[2], "peerDeviceId"),
            publicKey.copyOf(),
            decodeFrontier(ackFields[4]),
            signature.copyOf(),
        )
    }

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
        val fields =
            (DeterministicCbor.decodeCanonical(bytes) as? CborValue.Array)?.values
                ?: error("mailbox frame must be an array")
        require(fields.size == size) { "mailbox frame must have $size fields" }
        require(fields[0] == CborValue.Text(label)) { "unexpected mailbox frame label" }
        require(fields[1] == CborValue.Integer(SCHEMA)) { "unsupported mailbox frame schema" }
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
