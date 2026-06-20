package com.pomo.crew

import com.google.gson.Gson
import java.security.SecureRandom
import java.util.Base64

public object CrewJoinCodeCodec {
    private const val RAW_PREFIX: String = "pomo-crew.v2."
    private const val LEGACY_PREFIX: String = "pomo-crew."
    private const val URI_PREFIX: String = "pomo://crew/join/v2/"
    private const val MAX_ENCODED_LENGTH: Int = 16 * 1024
    private val gson = Gson()

    public fun newPayload(
        crewName: String,
        crewId: String = randomHex(16),
        relays: List<String> = CrewDefaults.DEFAULT_RELAYS,
        key: String = randomHex(32),
    ): CrewJoinPayload {
        val normalizedName = requireNotNull(CrewValidation.normalizeCrewName(crewName)) {
            "Crew name is invalid"
        }
        return CrewJoinPayload(
            crewId = crewId,
            crewName = normalizedName,
            relays = normalizeRelays(relays),
            key = key,
        ).also(::requireValid)
    }

    public fun encode(payload: CrewJoinPayload): String = RAW_PREFIX + encodePayload(payload)

    public fun encodeUri(payload: CrewJoinPayload): String = URI_PREFIX + encodePayload(payload)

    public fun decode(value: String): CrewJoinPayload? {
        val encoded = when {
            value.startsWith(URI_PREFIX) -> value.removePrefix(URI_PREFIX)
            value.startsWith(RAW_PREFIX) -> value.removePrefix(RAW_PREFIX)
            else -> return null
        }
        if (encoded.isBlank() || encoded.length > MAX_ENCODED_LENGTH) return null
        return runCatching {
            val json = String(Base64.getUrlDecoder().decode(encoded), Charsets.UTF_8)
            val decoded = gson.fromJson(json, EncodedJoinPayload::class.java)
            CrewJoinPayload(
                crewId = decoded.crewId,
                crewName = CrewValidation.normalizeCrewName(decoded.crewName) ?: return null,
                relays = normalizeRelays(decoded.relays.orEmpty()),
                key = decoded.key,
                version = decoded.version,
            ).also(::requireValid)
        }.getOrNull()
    }

    public fun isLegacy(value: String): Boolean =
        value.startsWith(LEGACY_PREFIX) && !value.startsWith(RAW_PREFIX)

    private fun encodePayload(payload: CrewJoinPayload): String {
        requireValid(payload)
        val encoded = EncodedJoinPayload(
            version = CrewDefaults.PROTOCOL_VERSION,
            crewId = payload.crewId,
            crewName = requireNotNull(CrewValidation.normalizeCrewName(payload.crewName)),
            relays = normalizeRelays(payload.relays),
            key = payload.key,
        )
        val bytes = gson.toJson(encoded).toByteArray(Charsets.UTF_8)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun requireValid(payload: CrewJoinPayload) {
        require(payload.version == CrewDefaults.PROTOCOL_VERSION)
        require(CrewValidation.isLowerHex(payload.crewId, expectedLength = 32))
        require(CrewValidation.normalizeCrewName(payload.crewName) == payload.crewName)
        require(normalizeRelays(payload.relays).isNotEmpty())
        require(CrewValidation.isLowerHex(payload.key, expectedLength = 64))
    }

    private fun normalizeRelays(relays: List<String>): List<String> {
        val normalized = CrewRelayTransport.filterValidRelayUrls(relays)
            .take(CrewValidation.MAX_RELAYS)
        return normalized.ifEmpty { CrewDefaults.DEFAULT_RELAYS }
    }

    private data class EncodedJoinPayload(
        val version: Int = CrewDefaults.PROTOCOL_VERSION,
        val crewId: String = "",
        val crewName: String = "",
        val relays: List<String>? = emptyList(),
        val key: String = "",
    )

    private fun randomHex(byteCount: Int): String {
        val bytes = ByteArray(byteCount)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
