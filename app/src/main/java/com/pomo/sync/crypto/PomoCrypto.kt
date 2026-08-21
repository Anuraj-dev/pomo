package com.pomo.sync.crypto

import com.pomo.sync.protocol.PomoSuite
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.math.BigInteger
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.interfaces.ECKey
import java.security.spec.ECFieldFp
import java.text.Normalizer
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

internal data class AesGcmCiphertext(
    val nonce: ByteArray,
    val ciphertextAndTag: ByteArray,
)

internal object PomoCrypto {
    private val p256Order: BigInteger =
        BigInteger(
            "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
            16,
        )
    private val p256Prime =
        BigInteger(
            "ffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
            16,
        )
    private val p256A = p256Prime.subtract(BigInteger.valueOf(3))
    private val p256B =
        BigInteger(
            "5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b",
            16,
        )
    private val p256GeneratorX =
        BigInteger(
            "6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
            16,
        )
    private val p256GeneratorY =
        BigInteger(
            "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
            16,
        )
    private val p256HalfOrder: BigInteger = p256Order.shiftRight(1)

    fun sha256(value: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(value)

    fun hkdfSha256(
        ikm: ByteArray,
        salt: ByteArray,
        info: ByteArray,
        outputBytes: Int,
    ): ByteArray {
        require(outputBytes in 1..(255 * 32))
        val actualSalt = if (salt.isEmpty()) ByteArray(32) else salt
        val prk = hmac(actualSalt, ikm)
        var previous = ByteArray(0)
        val output = ByteArray(outputBytes)
        var completed = false
        return try {
            var offset = 0
            var counter = 1
            while (offset < outputBytes) {
                val block = hmac(prk, previous + info + byteArrayOf(counter.toByte()))
                val count = minOf(block.size, outputBytes - offset)
                block.copyInto(output, offset, 0, count)
                previous.fill(0)
                previous = block
                offset += count
                counter += 1
            }
            completed = true
            output
        } finally {
            if (!completed) output.fill(0)
            previous.fill(0)
            prk.fill(0)
        }
    }

    fun encryptAesGcm(
        key: ByteArray,
        nonce: ByteArray,
        aad: ByteArray,
        plaintext: ByteArray,
    ): AesGcmCiphertext {
        require(key.size == 32) { "POMO-SUITE-1 content key must be AES-256" }
        require(nonce.size == PomoSuite.GCM_NONCE_BYTES)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(PomoSuite.GCM_TAG_BITS, nonce),
        )
        cipher.updateAAD(aad)
        return AesGcmCiphertext(nonce.copyOf(), cipher.doFinal(plaintext))
    }

    fun decryptAesGcm(
        key: ByteArray,
        sealed: AesGcmCiphertext,
        aad: ByteArray,
    ): ByteArray {
        require(key.size == 32)
        require(sealed.nonce.size == PomoSuite.GCM_NONCE_BYTES)
        require(sealed.ciphertextAndTag.size >= PomoSuite.GCM_TAG_BITS / 8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            SecretKeySpec(key, "AES"),
            GCMParameterSpec(PomoSuite.GCM_TAG_BITS, sealed.nonce),
        )
        cipher.updateAAD(aad)
        return cipher.doFinal(sealed.ciphertextAndTag)
    }

    fun signP256LowS(
        privateKey: PrivateKey,
        message: ByteArray,
    ): ByteArray {
        requireP256Key(privateKey)
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(privateKey)
        signer.update(message)
        val (r, originalS) = decodeDerSignature(signer.sign())
        val s = if (originalS > p256HalfOrder) p256Order - originalS else originalS
        return fixed(r) + fixed(s)
    }

    fun verifyP256LowS(
        publicKey: PublicKey,
        message: ByteArray,
        rawSignature: ByteArray,
    ) {
        requireP256Key(publicKey)
        require(rawSignature.size == PomoSuite.RAW_P256_SIGNATURE_BYTES) { "ESP256 signature must be 64 bytes" }
        val r = BigInteger(1, rawSignature.copyOfRange(0, 32))
        val s = BigInteger(1, rawSignature.copyOfRange(32, 64))
        require(r.signum() > 0 && r < p256Order) { "ESP256 r is out of range" }
        require(s.signum() > 0 && s <= p256HalfOrder) { "ESP256 signature is not low-S" }
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(publicKey)
        verifier.update(message)
        require(verifier.verify(encodeDerSignature(r, s))) { "Invalid ESP256 signature" }
    }

    private fun requireP256Key(key: Any) {
        val parameters = (key as? ECKey)?.params ?: error("ESP256 requires an EC key")
        val field =
            parameters.curve.field as? ECFieldFp
                ?: error("ESP256 requires a prime-field P-256 key")
        require(
            field.p == p256Prime &&
                parameters.curve.a == p256A &&
                parameters.curve.b == p256B &&
                parameters.generator.affineX == p256GeneratorX &&
                parameters.generator.affineY == p256GeneratorY &&
                parameters.order == p256Order &&
                parameters.cofactor == 1,
        ) { "ESP256 requires secp256r1" }
    }

    fun argon2id(
        passphrase: String,
        salt: ByteArray,
    ): ByteArray {
        require(passphrase.isNotEmpty()) { "Recovery passphrase must not be empty" }
        requireWellFormedUnicode(passphrase)
        require(Normalizer.isNormalized(passphrase, Normalizer.Form.NFC)) {
            "Recovery passphrase must be NFC-normalized"
        }
        requireArgon2Profile(
            version = Argon2Parameters.ARGON2_VERSION_13,
            memoryKiB = PomoSuite.ARGON2_MEMORY_KIB,
            passes = PomoSuite.ARGON2_ITERATIONS,
            parallelism = PomoSuite.ARGON2_LANES,
            saltLength = salt.size,
            outputLength = PomoSuite.ARGON2_OUTPUT_BYTES,
        )
        val password = passphrase.toByteArray(StandardCharsets.UTF_8)
        return try {
            argon2idVector(
                password = password,
                salt = salt,
                memoryKiB = PomoSuite.ARGON2_MEMORY_KIB,
                passes = PomoSuite.ARGON2_ITERATIONS,
                parallelism = PomoSuite.ARGON2_LANES,
                outputLength = PomoSuite.ARGON2_OUTPUT_BYTES,
            )
        } finally {
            password.fill(0)
        }
    }

    fun requireArgon2Profile(
        version: Int,
        memoryKiB: Int,
        passes: Int,
        parallelism: Int,
        saltLength: Int,
        outputLength: Int,
    ) {
        require(version == Argon2Parameters.ARGON2_VERSION_13)
        require(memoryKiB == PomoSuite.ARGON2_MEMORY_KIB)
        require(passes == PomoSuite.ARGON2_ITERATIONS)
        require(parallelism == PomoSuite.ARGON2_LANES)
        require(saltLength == PomoSuite.ARGON2_SALT_BYTES)
        require(outputLength == PomoSuite.ARGON2_OUTPUT_BYTES)
    }

    /** Generic primitive seam used only for published Argon2id conformance vectors. */
    fun argon2idVector(
        password: ByteArray,
        salt: ByteArray,
        memoryKiB: Int,
        passes: Int,
        parallelism: Int,
        outputLength: Int,
        secret: ByteArray = ByteArray(0),
        associatedData: ByteArray = ByteArray(0),
    ): ByteArray {
        require(memoryKiB >= 8 * parallelism && passes > 0 && parallelism > 0 && outputLength > 0)
        val passwordCopy = password.copyOf()
        val output = ByteArray(outputLength)
        var completed = false
        var parameters: Argon2Parameters? = null
        return try {
            val configuredParameters =
                Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                    .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                    .withMemoryAsKB(memoryKiB)
                    .withIterations(passes)
                    .withParallelism(parallelism)
                    .withSalt(salt.copyOf())
                    .withSecret(secret.copyOf())
                    .withAdditional(associatedData.copyOf())
                    .build()
            parameters = configuredParameters
            Argon2BytesGenerator().apply { init(configuredParameters) }.generateBytes(passwordCopy, output)
            completed = true
            output
        } finally {
            if (!completed) output.fill(0)
            passwordCopy.fill(0)
            parameters?.clear()
        }
    }

    private fun hmac(
        key: ByteArray,
        value: ByteArray,
    ): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(value)
    }

    private fun requireWellFormedUnicode(value: String) {
        var index = 0
        while (index < value.length) {
            when {
                Character.isHighSurrogate(value[index]) -> {
                    require(index + 1 < value.length && Character.isLowSurrogate(value[index + 1])) {
                        "Recovery passphrase must contain only Unicode scalar values"
                    }
                    index += 2
                }
                Character.isLowSurrogate(value[index]) -> {
                    throw IllegalArgumentException("Recovery passphrase must contain only Unicode scalar values")
                }
                else -> index += 1
            }
        }
    }

    private fun decodeDerSignature(der: ByteArray): Pair<BigInteger, BigInteger> {
        var offset = 0

        fun octet(): Int {
            require(offset < der.size) { "Truncated ECDSA DER" }
            return der[offset++].toInt() and 0xff
        }

        fun length(): Int {
            val first = octet()
            require(first != 0x80) { "Indefinite DER" }
            if (first < 0x80) return first
            val count = first and 0x7f
            require(count in 1..2)
            var value = 0
            repeat(count) { value = (value shl 8) or octet() }
            require(value >= 0x80) { "Non-minimal DER length" }
            return value
        }

        require(octet() == 0x30)
        require(length() == der.size - offset)

        fun integer(): BigInteger {
            require(octet() == 0x02)
            val count = length()
            require(count in 1..33 && offset + count <= der.size)
            val encoded = der.copyOfRange(offset, offset + count)
            offset += count
            require((encoded[0].toInt() and 0x80) == 0) { "Negative DER integer" }
            require(encoded.size == 1 || encoded[0] != 0.toByte() || (encoded[1].toInt() and 0x80) != 0) {
                "Non-minimal DER integer"
            }
            return BigInteger(1, encoded)
        }
        val r = integer()
        val s = integer()
        require(offset == der.size)
        require(r.signum() > 0 && r < p256Order && s.signum() > 0 && s < p256Order)
        return r to s
    }

    private fun encodeDerSignature(
        r: BigInteger,
        s: BigInteger,
    ): ByteArray {
        fun integer(value: BigInteger): ByteArray {
            val encoded = value.toByteArray()
            return byteArrayOf(0x02, encoded.size.toByte()) + encoded
        }
        val body = integer(r) + integer(s)
        require(body.size < 128)
        return byteArrayOf(0x30, body.size.toByte()) + body
    }

    private fun fixed(value: BigInteger): ByteArray {
        val encoded = value.toByteArray()
        val unsigned = if (encoded.size == 33 && encoded[0] == 0.toByte()) encoded.copyOfRange(1, 33) else encoded
        require(unsigned.size <= 32)
        return ByteArray(32).also { unsigned.copyInto(it, 32 - unsigned.size) }
    }
}
