package com.pomo.crew

import com.google.gson.Gson
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

public object CrewSnapshotCodec {
    private const val NONCE_BYTES: Int = 12
    private const val GCM_TAG_BITS: Int = 128
    private const val AES_ALGORITHM: String = "AES"
    private const val CIPHER_ALGORITHM: String = "AES/GCM/NoPadding"
    private val gson = Gson()

    public fun encodePlaintext(snapshot: CrewSnapshot): String {
        require(CrewValidation.isValidSnapshot(snapshot))
        return gson.toJson(snapshot)
    }

    public fun decodePlaintext(payload: String): CrewSnapshot? {
        if (payload.toByteArray(Charsets.UTF_8).size > CrewValidation.MAX_SNAPSHOT_BYTES) return null
        return try {
            gson.fromJson(payload, CrewSnapshot::class.java)
                ?.takeIf(CrewValidation::isValidSnapshot)
        } catch (_: Exception) {
            null
        }
    }

    public fun encodeEncrypted(snapshot: CrewSnapshot, crewKey: String): String {
        require(CrewValidation.isValidSnapshot(snapshot))
        val nonce = ByteArray(NONCE_BYTES)
        SecureRandom().nextBytes(nonce)
        val envelope = CrewSnapshotEnvelope(
            crewId = snapshot.crewId,
            identityPublicKey = snapshot.identityPublicKey,
            nonce = encode(nonce),
        )
        val ciphertext = encrypt(
            plaintext = encodePlaintext(snapshot).toByteArray(Charsets.UTF_8),
            crewKey = crewKey,
            nonce = nonce,
            associatedData = associatedData(envelope),
        )
        return gson.toJson(envelope.copy(ciphertext = encode(ciphertext)))
    }

    public fun encodeEncrypted(snapshot: CrewSnapshot, crewKey: String, identity: CrewIdentity): String {
        require(snapshot.identityPublicKey == identity.publicKey)
        return encodeEncrypted(snapshot, crewKey)
    }

    public fun decodeEncrypted(payload: String, crewKey: String): CrewSnapshot? {
        return try {
            if (payload.toByteArray(Charsets.UTF_8).size > CrewValidation.MAX_SNAPSHOT_BYTES * 2) return null
            val envelope = decodeEnvelope(payload) ?: return null
            if (!envelope.isValid()) return null
            val plaintext = decrypt(
                ciphertext = decode(envelope.ciphertext),
                crewKey = crewKey,
                nonce = decode(envelope.nonce),
                associatedData = associatedData(envelope),
            )
            val snapshot = decodePlaintext(String(plaintext, Charsets.UTF_8)) ?: return null
            snapshot.takeIf {
                it.crewId == envelope.crewId &&
                    it.identityPublicKey == envelope.identityPublicKey
            }
        } catch (_: Exception) {
            null
        }
    }

    public fun decodeEnvelope(payload: String): CrewSnapshotEnvelope? = try {
        gson.fromJson(payload, CrewSnapshotEnvelope::class.java)
    } catch (_: Exception) {
        null
    }

    private fun CrewSnapshotEnvelope.isValid(): Boolean =
        version == CrewDefaults.PROTOCOL_VERSION &&
            CrewValidation.isLowerHex(crewId, expectedLength = 32) &&
            CrewValidation.isLowerHex(identityPublicKey, expectedLength = 64) &&
            nonce.isNotBlank() &&
            ciphertext.isNotBlank() &&
            runCatching { decode(nonce).size == NONCE_BYTES }.getOrDefault(false)

    private fun encrypt(
        plaintext: ByteArray,
        crewKey: String,
        nonce: ByteArray,
        associatedData: ByteArray,
    ): ByteArray {
        val cipher = Cipher.getInstance(CIPHER_ALGORITHM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey(crewKey), GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(associatedData)
        return cipher.doFinal(plaintext)
    }

    private fun decrypt(
        ciphertext: ByteArray,
        crewKey: String,
        nonce: ByteArray,
        associatedData: ByteArray,
    ): ByteArray {
        val cipher = Cipher.getInstance(CIPHER_ALGORITHM)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(crewKey), GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(associatedData)
        return cipher.doFinal(ciphertext)
    }

    private fun secretKey(crewKey: String): SecretKeySpec {
        require(CrewValidation.isLowerHex(crewKey, expectedLength = 64))
        return SecretKeySpec(with(CrewNostrKeys) { crewKey.hexToBytes() }, AES_ALGORITHM)
    }

    private fun associatedData(envelope: CrewSnapshotEnvelope): ByteArray =
        listOf(
            envelope.version.toString(),
            envelope.crewId,
            envelope.identityPublicKey,
        ).joinToString("\n").toByteArray(Charsets.UTF_8)

    private fun encode(bytes: ByteArray): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

    private fun decode(value: String): ByteArray =
        Base64.getUrlDecoder().decode(value)
}

public data class CrewSnapshotEnvelope(
    val version: Int = CrewDefaults.PROTOCOL_VERSION,
    val crewId: String = "",
    val identityPublicKey: String = "",
    val nonce: String = "",
    val ciphertext: String = "",
)
