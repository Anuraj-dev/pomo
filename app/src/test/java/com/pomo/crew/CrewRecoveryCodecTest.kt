package com.pomo.crew

import com.google.gson.Gson
import com.google.gson.JsonParser
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

public class CrewRecoveryCodecTest {
    private val joinPayload = CrewJoinPayload(
        crewId = "11".repeat(16),
        crewName = "Deep Work",
        relays = listOf("wss://relay.example"),
        key = "22".repeat(32),
    )
    private val payload = CrewRecoveryPayload(
        identityPrivateKey = CrewNostrKeys.generatePrivateKeyHex(),
        memberships = listOf(
            CrewMembership(
                crewId = joinPayload.crewId,
                crewName = joinPayload.crewName,
                joinCode = CrewJoinCodeCodec.encode(joinPayload),
                relays = joinPayload.relays,
                key = joinPayload.key,
                displayName = "Snehit",
            ),
        ),
    )

    @Test
    public fun recoveryRoundTripEncryptsPrivateMaterialAndRejectsWrongPassphrase() {
        val recovery = CrewRecoveryCodec.encode(payload, "correct horse battery".toCharArray())

        assertFalse(recovery.contains(payload.identityPrivateKey))
        assertEquals(payload, CrewRecoveryCodec.decode(recovery, "correct horse battery".toCharArray()))
        assertNull(CrewRecoveryCodec.decode(recovery, "wrong passphrase".toCharArray()))
    }

    @Test
    public fun recoveryDecodeUsesEnvelopeIterationsForForwardCompatibility() {
        val recovery = CrewRecoveryCodec.encode(payload, "correct horse battery".toCharArray())
        val migratedRecovery = recovery.withIterations(700_000)

        assertEquals(payload, CrewRecoveryCodec.decode(migratedRecovery, "correct horse battery".toCharArray()))
    }

    @Test(expected = IllegalArgumentException::class)
    public fun recoveryRejectsShortPassphrase() {
        CrewRecoveryCodec.encode(payload, "too short".toCharArray())
    }

    private fun String.withIterations(iterations: Int): String {
        val encodedEnvelope = removePrefix(PREFIX)
        val json = String(Base64.getUrlDecoder().decode(encodedEnvelope), Charsets.UTF_8)
        val envelope = JsonParser.parseString(json).asJsonObject.apply {
            addProperty("iterations", iterations)
        }
        val updatedJson = Gson().toJson(envelope)
        val updatedEnvelope = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(updatedJson.toByteArray(Charsets.UTF_8))
        return PREFIX + updatedEnvelope
    }

    private companion object {
        private const val PREFIX: String = "pomo-recovery.v1."
    }
}
