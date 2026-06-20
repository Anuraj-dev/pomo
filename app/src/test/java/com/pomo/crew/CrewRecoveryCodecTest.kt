package com.pomo.crew

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

    @Test(expected = IllegalArgumentException::class)
    public fun recoveryRejectsShortPassphrase() {
        CrewRecoveryCodec.encode(payload, "too short".toCharArray())
    }
}
