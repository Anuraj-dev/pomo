package com.pomo.sync.identity

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

/** Installation-scoped, non-exportable Android Device Identity authorities. */
internal class PlatformDeviceIdentityKeys(
    private val namespace: String,
    private val wrappedAgreementFile: File,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
) {
    init {
        require(namespace.matches(Regex("[a-z0-9._-]{1,64}")))
    }

    fun loadOrCreate(): Pair<KeyPair, KeyPair> = signingKey() to agreementKey()

    fun deleteAfterRevocation() {
        val store = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        store.deleteEntry(signingAlias)
        store.deleteEntry(agreementAlias)
        store.deleteEntry(wrapAlias)
        if (wrappedAgreementFile.exists()) wrappedAgreementFile.delete()
    }

    private fun signingKey(): KeyPair =
        existing(signingAlias) ?: generate(
            signingAlias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            KeyProperties.DIGEST_SHA256,
        )

    private fun agreementKey(): KeyPair =
        if (sdkInt >= Build.VERSION_CODES.S) {
            existing(agreementAlias) ?: generate(
                agreementAlias,
                KeyProperties.PURPOSE_AGREE_KEY,
                null,
            )
        } else {
            loadWrappedAgreement() ?: createWrappedAgreement()
        }

    private fun existing(alias: String): KeyPair? {
        val store = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        val privateKey = store.getKey(alias, null) as? java.security.PrivateKey ?: return null
        val publicKey = store.getCertificate(alias)?.publicKey ?: return null
        return KeyPair(publicKey, privateKey)
    }

    private fun generate(
        alias: String,
        purposes: Int,
        digest: String?,
    ): KeyPair =
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEY_STORE).run {
            val builder =
                KeyGenParameterSpec.Builder(alias, purposes)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setUserAuthenticationRequired(false)
            if (digest != null) builder.setDigests(digest)
            initialize(builder.build())
            generateKeyPair()
        }

    private fun wrapKey(): javax.crypto.SecretKey {
        val store = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        val existing = store.getKey(wrapAlias, null) as? javax.crypto.SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        generator.init(
            KeyGenParameterSpec.Builder(wrapAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private fun createWrappedAgreement(): KeyPair {
        wrappedAgreementFile.parentFile?.mkdirs()
        val pair =
            KeyPairGenerator.getInstance("EC").run {
                initialize(ECGenParameterSpec("secp256r1"))
                generateKeyPair()
            }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, wrapKey())
        val iv = cipher.iv
        val wrapped = cipher.doFinal(pair.private.encoded)
        val publicBytes = pair.public.encoded
        wrappedAgreementFile.writeBytes(
            byteArrayOf(1, iv.size.toByte()) + iv +
                publicBytes.size.toShort().let { byteArrayOf((it.toInt() shr 8).toByte(), it.toByte()) } +
                publicBytes + wrapped,
        )
        return pair
    }

    private fun loadWrappedAgreement(): KeyPair? {
        if (!wrappedAgreementFile.isFile) return null
        val bytes = wrappedAgreementFile.readBytes()
        if (bytes.size < 6 || bytes[0] != 1.toByte()) return null
        val ivSize = bytes[1].toInt() and 0xff
        var cursor = 2
        val iv = bytes.copyOfRange(cursor, cursor + ivSize)
        cursor += ivSize
        val publicSize = ((bytes[cursor].toInt() and 0xff) shl 8) or (bytes[cursor + 1].toInt() and 0xff)
        cursor += 2
        val publicBytes = bytes.copyOfRange(cursor, cursor + publicSize)
        val wrapped = bytes.copyOfRange(cursor + publicSize, bytes.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, wrapKey(), GCMParameterSpec(128, iv))
        val privateBytes = cipher.doFinal(wrapped)
        val factory = java.security.KeyFactory.getInstance("EC")
        return KeyPair(
            factory.generatePublic(X509EncodedKeySpec(publicBytes)),
            factory.generatePrivate(PKCS8EncodedKeySpec(privateBytes)),
        )
    }

    private val signingAlias: String = "pomo.$namespace.device.signing"
    private val agreementAlias: String = "pomo.$namespace.device.agreement"
    private val wrapAlias: String = "pomo.$namespace.device.wrap"

    private companion object {
        const val ANDROID_KEY_STORE: String = "AndroidKeyStore"
    }
}
