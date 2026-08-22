package com.pomo.sync.transport

import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.crypto.PomoCrypto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

public class ReplicaLanHttpTest {
    @Test
    public fun chromeHttpPostUsesTheReplicaLanCodec() {
        val ingested = mutableListOf<ByteArray>()
        val listener =
            ReplicaLanListener(
                session(
                    pair,
                    { wire ->
                        ingested.add(wire.copyOf())
                        "ACCEPTED"
                    },
                    { emptyList() },
                ),
            )
        val port = listener.start()
        try {
            val envelope = SyncEnvelope("op-1", "feed", 1, byteArrayOf(9))
            val response =
                ReplicaLanListener.exchangeHttp(
                    "http://127.0.0.1:$port${ReplicaLanListener.HTTP_PATH}",
                    ReplicaLanRequest("aa".repeat(32), listOf(envelope)),
                )
            assertEquals(sessionDeviceId(pair), response.deviceId)
            assertTrue(ReplicaLanSession.verifyAck(response.ack).signatureVerified)
            assertEquals(1, ingested.size)
            assertEquals(9.toByte(), ingested[0]!![0])
        } finally {
            listener.stop()
        }
    }

    private val pair: KeyPair = generate()

    private fun session(
        keys: KeyPair,
        ingest: (ByteArray) -> String,
        outbox: () -> List<SyncEnvelope>,
    ): ReplicaLanSession {
        val publicKey = HpkeP256.serialize(keys.public)
        return ReplicaLanSession(sessionDeviceId(keys), publicKey, { PomoCrypto.signP256LowS(keys.private, it) }, ingest, outbox)
    }

    private fun sessionDeviceId(keys: KeyPair): String =
        PomoCrypto.sha256(HpkeP256.serialize(keys.public)).joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun generate(): KeyPair =
        KeyPairGenerator.getInstance("EC").run {
            initialize(ECGenParameterSpec("secp256r1"))
            generateKeyPair()
        }
}
