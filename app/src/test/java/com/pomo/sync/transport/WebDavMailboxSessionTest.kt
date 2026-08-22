package com.pomo.sync.transport

import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.crypto.PomoCrypto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

public class WebDavMailboxSessionTest {
    @Test
    public fun sharedMailboxClearsOutboxOnlyAfterPeerSignedAck() {
        val store = MemoryMailbox()
        val pairA = generate()
        val pairB = generate()
        val sessionA = session(pairA, "primary", store, listOf(deviceId(pairB)), { "ACCEPTED" })
        val sessionB = session(pairB, "primary", store, listOf(deviceId(pairA)), { "ACCEPTED" })
        val envelope = SyncEnvelope("op-1", "feed", 1, byteArrayOf(9))

        val first =
            OrdinaryDrainHost(listOf(sessionA.drainRoute()), { }, { }).drain(listOf(envelope))
        assertTrue(first.connectedOrRouted())
        assertTrue(first.delivered.isEmpty())
        assertEquals(setOf("op-1"), first.remaining)

        OrdinaryDrainHost(listOf(sessionB.drainRoute()), { }, { }).drain(emptyList())

        val delivered = mutableListOf<String>()
        val second =
            OrdinaryDrainHost(listOf(sessionA.drainRoute()), { }, delivered::add).drain(listOf(envelope))
        assertEquals(setOf("op-1"), second.delivered)
        assertEquals(listOf("op-1"), delivered)
        assertTrue(second.remaining.isEmpty())
    }

    @Test
    public fun forgedMailboxAckDoesNotClearObligations() {
        val store = MemoryMailbox()
        val pairA = generate()
        val pairB = generate()
        val sessionA = session(pairA, "primary", store, listOf(deviceId(pairB)), { "ACCEPTED" })
        val envelope = SyncEnvelope("op-1", "feed", 1, byteArrayOf(1))
        OrdinaryDrainHost(listOf(sessionA.drainRoute()), { }, { }).drain(listOf(envelope))
        val ackLocator = WebDavMailboxCodec.ackLocator(deviceId(pairA))
        store.put(ackLocator, byteArrayOf(1, 2, 3))
        val delivered = mutableListOf<String>()
        val result =
            OrdinaryDrainHost(listOf(sessionA.drainRoute()), { }, delivered::add).drain(listOf(envelope))
        assertTrue(delivered.isEmpty())
        assertEquals(setOf("op-1"), result.remaining)
        assertFalse(result.live)
    }

    private fun DrainResult.connectedOrRouted(): Boolean = !localOnly

    private fun session(
        pair: KeyPair,
        mailboxId: String,
        client: ImmutableMailboxClient,
        peers: List<String>,
        ingest: (ByteArray) -> String,
    ): WebDavMailboxSession {
        val publicKey = HpkeP256.serialize(pair.public)
        return WebDavMailboxSession(
            deviceId = deviceId(pair),
            publicKey = publicKey,
            mailboxId = mailboxId,
            client = client,
            peerDeviceIds = peers,
            sign = { PomoCrypto.signP256LowS(pair.private, it) },
            ingest = ingest,
        )
    }

    private fun deviceId(pair: KeyPair): String {
        val publicKey = HpkeP256.serialize(pair.public)
        return PomoCrypto.sha256(publicKey).joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun generate(): KeyPair =
        KeyPairGenerator.getInstance("EC").run {
            initialize(ECGenParameterSpec("secp256r1"))
            generateKeyPair()
        }

    private class MemoryMailbox(val objects: MutableMap<String, ByteArray> = linkedMapOf()) : ImmutableMailboxClient {
        override fun createIfAbsent(
            objectId: String,
            bytes: ByteArray,
        ): Boolean {
            if (objectId in objects) return false
            objects[objectId] = bytes.copyOf()
            return true
        }

        override fun get(objectId: String): ByteArray? = objects[objectId]?.copyOf()

        override fun put(
            objectId: String,
            bytes: ByteArray,
        ) {
            objects[objectId] = bytes.copyOf()
        }
    }
}
