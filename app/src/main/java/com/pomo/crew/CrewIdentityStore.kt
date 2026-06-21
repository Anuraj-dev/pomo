package com.pomo.crew

import android.content.Context

public class CrewIdentityStore(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val legacyPrefs = context.applicationContext
        .getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE)
    private val cipher: CrewSecretCipher by lazy { CrewSecretCipher() }

    public fun identity(): CrewIdentity {
        val encrypted = prefs.getString(IDENTITY_KEY, null)
        val existing = encrypted?.let(cipher::decryptString)
        if (existing != null && CrewValidation.isLowerHex(existing, 64)) {
            return CrewIdentity(existing, publicKeyFor(existing))
        }

        val legacy = legacyPrefs.getString(LEGACY_IDENTITY_KEY, null)
            ?.takeIf { CrewValidation.isLowerHex(it, 64) }
        val privateKey = legacy ?: CrewNostrKeys.generatePrivateKeyHex()
        replaceIdentity(privateKey)
        legacyPrefs.edit()
            .remove(LEGACY_IDENTITY_KEY)
            .remove(LEGACY_RSA_PRIVATE_KEY)
            .remove(LEGACY_RSA_PUBLIC_KEY)
            .apply()
        return CrewIdentity(privateKey, publicKeyFor(privateKey))
    }

    public fun publicKey(): String {
        val existing = prefs.getString(IDENTITY_PUBLIC_KEY, null)
        if (existing != null && CrewValidation.isLowerHex(existing, 64)) return existing
        return identity().publicKey
    }

    public fun replaceIdentity(privateKey: String) {
        require(CrewValidation.isLowerHex(privateKey, 64))
        prefs.edit()
            .putString(IDENTITY_KEY, cipher.encryptString(privateKey))
            .putString(IDENTITY_PUBLIC_KEY, CrewNostrKeys.publicKeyHex(privateKey))
            .commit()
    }

    private fun publicKeyFor(privateKey: String): String {
        val publicKey = CrewNostrKeys.publicKeyHex(privateKey)
        if (prefs.getString(IDENTITY_PUBLIC_KEY, null) != publicKey) {
            prefs.edit().putString(IDENTITY_PUBLIC_KEY, publicKey).apply()
        }
        return publicKey
    }

    private companion object {
        private const val PREFS_NAME: String = "crew_secure"
        private const val IDENTITY_KEY: String = "identity_private_key"
        private const val IDENTITY_PUBLIC_KEY: String = "identity_public_key"
        private const val LEGACY_PREFS_NAME: String = "pairing_prefs"
        private const val LEGACY_IDENTITY_KEY: String = "crew_nostr_private_key"
        private const val LEGACY_RSA_PRIVATE_KEY: String = "crew_identity_private_key"
        private const val LEGACY_RSA_PUBLIC_KEY: String = "crew_identity_public_key"
    }
}
