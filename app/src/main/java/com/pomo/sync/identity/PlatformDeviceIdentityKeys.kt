package com.pomo.sync.identity

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.ECGenParameterSpec

/** Installation-scoped, non-exportable Android Device Identity authorities. */
internal class PlatformDeviceIdentityKeys(
    private val namespace: String,
) {
    init {
        require(namespace.matches(Regex("[a-z0-9._-]{1,64}")))
    }

    fun loadOrCreate(): Pair<KeyPair, KeyPair> = signingKey() to agreementKey()

    fun deleteAfterRevocation() {
        val store = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        store.deleteEntry(signingAlias)
        store.deleteEntry(agreementAlias)
    }

    private fun signingKey(): KeyPair =
        existing(signingAlias) ?: generate(
            signingAlias,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
            KeyProperties.DIGEST_SHA256,
        )

    private fun agreementKey(): KeyPair =
        existing(agreementAlias) ?: generate(
            agreementAlias,
            KeyProperties.PURPOSE_AGREE_KEY,
            null,
        )

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

    private val signingAlias: String = "pomo.$namespace.device.signing"
    private val agreementAlias: String = "pomo.$namespace.device.agreement"

    private companion object {
        const val ANDROID_KEY_STORE: String = "AndroidKeyStore"
    }
}
