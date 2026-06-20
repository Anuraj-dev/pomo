package com.pomo.crew

import com.google.gson.Gson
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

public data class CrewRecoveryPayload(
    val identityPrivateKey: String,
    val memberships: List<CrewMembership>,
)

public object CrewRecoveryCodec {
    private const val PREFIX: String = "pomo-recovery.v1."
    private const val VERSION: Int = 1
    private const val PBKDF2_ITERATIONS: Int = 600_000
    private const val KEY_BITS: Int = 256
    private const val SALT_BYTES: Int = 16
    private const val NONCE_BYTES: Int = 12
    private const val GCM_TAG_BITS: Int = 128
    private val gson = Gson()

    public fun encode(payload: CrewRecoveryPayload, passphrase: CharArray): String {
        requireValid(payload)
        require(passphrase.size >= MIN_PASSPHRASE_LENGTH)
        val salt = ByteArray(SALT_BYTES).also(SecureRandom()::nextBytes)
        val nonce = ByteArray(NONCE_BYTES).also(SecureRandom()::nextBytes)
        val ciphertext = crypt(
            mode = Cipher.ENCRYPT_MODE,
            input = gson.toJson(payload).toByteArray(Charsets.UTF_8),
            passphrase = passphrase,
            salt = salt,
            nonce = nonce,
        )
        val envelope = RecoveryEnvelope(
            version = VERSION,
            kdf = KDF_NAME,
            iterations = PBKDF2_ITERATIONS,
            cipher = CIPHER_NAME,
            salt = encodeBytes(salt),
            nonce = encodeBytes(nonce),
            ciphertext = encodeBytes(ciphertext),
        )
        return PREFIX + encodeBytes(gson.toJson(envelope).toByteArray(Charsets.UTF_8))
    }

    public fun decode(value: String, passphrase: CharArray): CrewRecoveryPayload? {
        if (!value.startsWith(PREFIX) || value.length > MAX_ENCODED_LENGTH) return null
        return runCatching {
            val envelopeJson = String(decodeBytes(value.removePrefix(PREFIX)), Charsets.UTF_8)
            val envelope = gson.fromJson(envelopeJson, RecoveryEnvelope::class.java)
            if (!envelope.isSupported()) return null
            val plaintext = crypt(
                mode = Cipher.DECRYPT_MODE,
                input = decodeBytes(envelope.ciphertext),
                passphrase = passphrase,
                salt = decodeBytes(envelope.salt),
                nonce = decodeBytes(envelope.nonce),
            )
            gson.fromJson(String(plaintext, Charsets.UTF_8), CrewRecoveryPayload::class.java)
                ?.takeIf(::isValid)
        }.getOrNull()
    }

    private fun crypt(
        mode: Int,
        input: ByteArray,
        passphrase: CharArray,
        salt: ByteArray,
        nonce: ByteArray,
    ): ByteArray {
        val spec = PBEKeySpec(passphrase, salt, PBKDF2_ITERATIONS, KEY_BITS)
        val keyBytes = try {
            SecretKeyFactory.getInstance(KDF_NAME).generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
        return try {
            val cipher = Cipher.getInstance(CIPHER_NAME)
            cipher.init(mode, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(GCM_TAG_BITS, nonce))
            cipher.doFinal(input)
        } finally {
            keyBytes.fill(0)
        }
    }

    private fun RecoveryEnvelope.isSupported(): Boolean =
        version == VERSION &&
            kdf == KDF_NAME &&
            iterations == PBKDF2_ITERATIONS &&
            cipher == CIPHER_NAME &&
            runCatching { decodeBytes(salt).size == SALT_BYTES }.getOrDefault(false) &&
            runCatching { decodeBytes(nonce).size == NONCE_BYTES }.getOrDefault(false) &&
            ciphertext.isNotBlank()

    private fun requireValid(payload: CrewRecoveryPayload) {
        require(isValid(payload))
    }

    private fun isValid(payload: CrewRecoveryPayload): Boolean =
        CrewValidation.isLowerHex(payload.identityPrivateKey, 64) &&
            payload.memberships.isNotEmpty() &&
            payload.memberships.all { membership ->
                membership.protocolVersion == CrewDefaults.PROTOCOL_VERSION &&
                    !membership.isArchived &&
                    CrewJoinCodeCodec.decode(membership.joinCode)?.let { decoded ->
                        decoded.crewId == membership.crewId && decoded.key == membership.key
                    } == true
            }

    private fun encodeBytes(bytes: ByteArray): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private fun decodeBytes(value: String): ByteArray = Base64.getUrlDecoder().decode(value)

    private data class RecoveryEnvelope(
        val version: Int = VERSION,
        val kdf: String = KDF_NAME,
        val iterations: Int = PBKDF2_ITERATIONS,
        val cipher: String = CIPHER_NAME,
        val salt: String = "",
        val nonce: String = "",
        val ciphertext: String = "",
    )

    private const val KDF_NAME: String = "PBKDF2WithHmacSHA256"
    private const val CIPHER_NAME: String = "AES/GCM/NoPadding"
    private const val MIN_PASSPHRASE_LENGTH: Int = 12
    private const val MAX_ENCODED_LENGTH: Int = 128 * 1024
}
