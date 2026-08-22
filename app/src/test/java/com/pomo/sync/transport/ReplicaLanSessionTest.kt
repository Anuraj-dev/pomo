package com.pomo.sync.transport

import com.pomo.sync.crypto.CoseKernelSigner
import com.pomo.sync.crypto.CoseKernelVerifier
import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.protocol.AuthorRequest
import com.pomo.sync.protocol.AuthorResult
import com.pomo.sync.protocol.CheckpointVerifier
import com.pomo.sync.protocol.IngestDisposition
import com.pomo.sync.protocol.OperationKernel
import com.pomo.sync.protocol.OperationStore
import com.pomo.sync.protocol.PreferenceSet
import com.pomo.sync.protocol.PreferenceValue
import com.pomo.sync.protocol.ProtocolBytes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

public class ReplicaLanSessionTest {
    @Test
    public fun signedLanExchangeIngestsThroughKernelAndClearsCoveredOutbox() {
        val keys = mapOf(id(2).toString() to pairA, id(3).toString() to pairB)
        val kernelA = kernel(pairA, keys)
        val kernelB = kernel(pairB, keys)
        val authored = kernelA.author(authorRequest(id(2), "bell")) as AuthorResult.Authored
        val envelope =
            SyncEnvelope(
                authored.value.operationId.toString(),
                "${authored.value.operation.deviceId}:${authored.value.operation.incarnationId}",
                authored.value.operation.sequence,
                authored.value.signedEnvelope.copyOf(),
            )
        val sessionA = session("aa".repeat(32), pairA, { "ACCEPTED" }, { listOf(envelope) })
        val sessionB = session("bb".repeat(32), pairB, { wire -> kernelB.ingest(wire).name }, { emptyList() })
        val delivered = mutableListOf<String>()
        val result =
            OrdinaryDrainHost(
                listOf(sessionA.drainRoute(sessionB.deviceId) { sessionB.handle(it) }),
                { wire -> kernelA.ingest(wire) },
                delivered::add,
            ).drain(listOf(envelope))
        assertFalse(result.localOnly)
        assertEquals(setOf(envelope.operationId), result.delivered)
        assertTrue(result.remaining.isEmpty())
        assertEquals(listOf(envelope.operationId), delivered)
        assertEquals("bell", kernelB.materializedPreference("timer.sound"))
        assertTrue(result.live)
    }

    @Test
    public fun forgedAckDoesNotClearObligations() {
        val pair = pairA
        val envelope = SyncEnvelope("op-1", "feed", 1, byteArrayOf(1))
        val honest = session("aa".repeat(32), pair, { "ACCEPTED" }, { emptyList() })
        val route =
            object : DrainRoute {
                override val name: String = "forged"

                override fun exchange(batch: List<SyncEnvelope>): DrainExchange {
                    val response = honest.handle(ReplicaLanRequest("bb".repeat(32), batch))
                    val forged = response.ack.copy(signature = response.ack.signature.copyOf().also { it[0] = (it[0] + 1).toByte() })
                    return DrainExchange(ack = ReplicaLanSession.verifyAck(forged), connected = true)
                }
            }
        val delivered = mutableListOf<String>()
        val result = OrdinaryDrainHost(listOf(route), { }, delivered::add).drain(listOf(envelope))
        assertTrue(delivered.isEmpty())
        assertEquals(setOf("op-1"), result.remaining)
        assertFalse(result.live)
    }

    @Test
    public fun rejectedEnvelopeIsNotAcked() {
        val sessionB = session("bb".repeat(32), pairB, { IngestDisposition.REJECTED_INVALID.name }, { emptyList() })
        val envelope = SyncEnvelope("op-1", "feed", 1, byteArrayOf(1))
        val response = sessionB.handle(ReplicaLanRequest("aa".repeat(32), listOf(envelope)))
        assertTrue(response.ack.frontier.isEmpty())
        assertTrue(ReplicaLanSession.verifyAck(response.ack).signatureVerified)
    }

    @Test
    public fun loopbackSocketCarriesSignedAck() {
        val sessionB = session("bb".repeat(32), pairB, { "ACCEPTED" }, { emptyList() })
        val listener = ReplicaLanListener(sessionB)
        val port = listener.start()
        try {
            val sessionA = session("aa".repeat(32), pairA, { "ACCEPTED" }, { emptyList() })
            val envelope = SyncEnvelope("op-1", "feed", 1, byteArrayOf(7))
            val delivered = mutableListOf<String>()
            val peer = ReplicaLanPeer(sessionB.deviceId, "127.0.0.1", port)
            val result =
                OrdinaryDrainHost(
                    listOf(sessionA.drainRoute(peer.deviceId) { ReplicaLanListener.exchange(peer, it) }),
                    { },
                    delivered::add,
                ).drain(listOf(envelope))
            assertEquals(setOf("op-1"), result.delivered)
            assertTrue(delivered.contains("op-1"))
            assertFalse(result.localOnly)
        } finally {
            listener.stop()
        }
    }

    @Test
    public fun replicaServiceNameStaysInsideDnsSdInstanceLimit() {
        val deviceId = "ab".repeat(32)
        assertEquals("pomo-abababab", ReplicaLanAdvertiser.serviceName(deviceId))
        assertTrue(ReplicaLanAdvertiser.serviceName(deviceId).length <= 63)
        assertEquals("_pomo-replica._tcp", ReplicaLanAdvertiser.SERVICE_TYPE)
    }

    private val pairA: KeyPair = generate()
    private val pairB: KeyPair = generate()

    private fun session(
        deviceId: String,
        pair: KeyPair,
        ingest: (ByteArray) -> String,
        outbox: () -> List<SyncEnvelope>,
    ): ReplicaLanSession =
        ReplicaLanSession(
            deviceId,
            HpkeP256.serialize(pair.public),
            { PomoCrypto.signP256LowS(pair.private, it) },
            ingest,
            outbox,
        )

    private fun kernel(
        pair: KeyPair,
        keys: Map<String, KeyPair>,
    ): OperationKernel =
        OperationKernel(
            CoseKernelSigner(pair.private),
            CoseKernelVerifier { id -> keys[id.toString()]?.public },
            OperationStore { },
            CheckpointVerifier { },
        )

    private fun authorRequest(
        deviceId: ProtocolBytes,
        value: String,
    ): AuthorRequest =
        AuthorRequest(
            memberId = id(1),
            deviceId = deviceId,
            incarnationId = ProtocolBytes.of(ByteArray(16) { 3 }, 16),
            authorizationEpoch = 1,
            frontier = emptyList(),
            preference = PreferenceSet("timer.sound", PreferenceValue.Text(value)),
            authorized = true,
            deviceReady = true,
            completePrerequisites = setOf("PROFILE_FRONTIER"),
        )

    private fun id(value: Byte): ProtocolBytes = ProtocolBytes.of(ByteArray(32) { value }, 32)

    private fun generate(): KeyPair =
        KeyPairGenerator.getInstance("EC").run {
            initialize(ECGenParameterSpec("secp256r1"))
            generateKeyPair()
        }
}
