package com.pomo.sync.identity

import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.protocol.ProtocolBytes
import org.junit.Assert.assertArrayEquals
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

public class ContentEpochSealTest {
    @Test
    public fun wrapAndOpenContentKeyForDeviceRecipient() {
        val recipient =
            KeyPairGenerator.getInstance("EC").run {
                initialize(ECGenParameterSpec("secp256r1"))
                generateKeyPair()
            }
        val memberId = ProtocolBytes.of(ByteArray(32) { 1 }, 32)
        val frontier = ProtocolBytes.of(ByteArray(32) { 2 }, 32)
        val recipientId = ProtocolBytes.of(ByteArray(32) { 3 }, 32)
        val contentKey = ByteArray(32) { 7 }
        val epochRecipient =
            EpochRecipient(
                recipientId,
                HpkeP256.serialize(recipient.public),
                recovery = false,
            )
        val wrap =
            ContentEpochSeal.wrap(
                memberId,
                3,
                frontier,
                contentKey,
                epochRecipient,
                recipient.public,
            )
        val opened =
            ContentEpochSeal.open(
                memberId,
                3,
                frontier,
                wrap,
                epochRecipient,
                recipient,
            )
        assertArrayEquals(contentKey, opened)
    }
}
