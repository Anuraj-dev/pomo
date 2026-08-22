package com.pomo.sync.identity

import com.pomo.sync.crypto.HpkeCiphertext
import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.protocol.CborValue
import com.pomo.sync.protocol.DeterministicCbor
import com.pomo.sync.protocol.ProtocolBytes
import java.security.KeyPair
import java.security.PublicKey

internal object ContentEpochSeal {
    val INFO: ByteArray = "content-epoch".toByteArray(Charsets.UTF_8)

    fun aad(
        memberId: ProtocolBytes,
        contentEpoch: Long,
        authorizationFrontierHash: ProtocolBytes,
        recipient: EpochRecipient,
    ): ByteArray =
        DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Text("Pomo Content Epoch Wrap"),
                    CborValue.Integer(1),
                    CborValue.Bytes(memberId.copy()),
                    CborValue.Integer(contentEpoch),
                    CborValue.Bytes(authorizationFrontierHash.copy()),
                    CborValue.Integer(if (recipient.recovery) 2 else 1),
                    CborValue.Bytes(recipient.recipientId.copy()),
                ),
            ),
        )

    fun wrap(
        memberId: ProtocolBytes,
        contentEpoch: Long,
        authorizationFrontierHash: ProtocolBytes,
        contentKey: ByteArray,
        recipient: EpochRecipient,
        recipientPublicKey: PublicKey,
    ): ContentEpochWrap {
        require(contentKey.size == 32)
        val sealed =
            HpkeP256.seal(
                recipientPublicKey,
                INFO.copyOf(),
                aad(memberId, contentEpoch, authorizationFrontierHash, recipient),
                contentKey,
            )
        return ContentEpochWrap(
            recipient.recipientId,
            recipient.recovery,
            sealed.encapsulatedKey.copyOf(),
            sealed.ciphertextAndTag.copyOf(),
        )
    }

    fun open(
        memberId: ProtocolBytes,
        contentEpoch: Long,
        authorizationFrontierHash: ProtocolBytes,
        wrap: ContentEpochWrap,
        recipient: EpochRecipient,
        recipientKeyPair: KeyPair,
    ): ByteArray =
        HpkeP256.open(
            recipientKeyPair.private,
            recipientKeyPair.public,
            HpkeCiphertext(wrap.encapsulatedKey.copyOf(), wrap.ciphertextAndTag.copyOf()),
            INFO.copyOf(),
            aad(memberId, contentEpoch, authorizationFrontierHash, recipient),
        )
}
