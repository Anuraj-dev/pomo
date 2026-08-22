package com.pomo.sync.transport

import com.pomo.sync.crypto.AesGcmCiphertext
import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.protocol.CborValue
import com.pomo.sync.protocol.DeterministicCbor

/**
 * Optional content-epoch wrapping for provider object bytes (WebDAV / Nostr).
 * When no key is installed, bytes pass through unchanged.
 */
internal object ProviderWrap {
    const val LABEL: String = "pomo-provider-wrapped"
    const val SCHEMA: Long = 1

    @Volatile
    private var contentKey: ByteArray? = null

    fun installContentKey(key: ByteArray?) {
        require(key == null || key.size == 32)
        contentKey = key?.copyOf()
    }

    fun installed(): Boolean = contentKey != null

    fun wrap(plaintext: ByteArray): ByteArray {
        val key = contentKey ?: return plaintext.copyOf()
        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val sealed = PomoCrypto.encryptAesGcm(key, nonce, ByteArray(0), plaintext)
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Text(LABEL),
                    CborValue.Integer(SCHEMA),
                    CborValue.Bytes(sealed.nonce.copyOf()),
                    CborValue.Bytes(sealed.ciphertextAndTag.copyOf()),
                ),
            ),
        )
    }

    fun open(bytes: ByteArray): ByteArray {
        val key = contentKey ?: return bytes.copyOf()
        val fields =
            runCatching {
                (DeterministicCbor.decodeCanonical(bytes) as? CborValue.Array)?.values
            }.getOrNull() ?: return bytes.copyOf()
        if (fields.size != 4 || fields[0] != CborValue.Text(LABEL) || fields[1] != CborValue.Integer(SCHEMA)) {
            return bytes.copyOf()
        }
        val nonce = (fields[2] as? CborValue.Bytes)?.value ?: error("invalid provider wrap nonce")
        val ciphertext = (fields[3] as? CborValue.Bytes)?.value ?: error("invalid provider wrap ciphertext")
        return PomoCrypto.decryptAesGcm(key, AesGcmCiphertext(nonce, ciphertext), ByteArray(0))
    }
}
