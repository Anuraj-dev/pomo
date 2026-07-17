package com.pomo.crew

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

public class CrewSnapshotCodecTest {
    private val gson = Gson()
    private val privateKey = CrewNostrKeys.generatePrivateKeyHex()
    private val identity = CrewIdentity(privateKey, CrewNostrKeys.publicKeyHex(privateKey))
    private val crewKey = "22".repeat(32)
    private val snapshot =
        CrewSnapshot(
            crewId = "11".repeat(16),
            identityPublicKey = identity.publicKey,
            displayName = "Snehit",
            allTimeFocusMinutes = 125,
            publishedAtEpochSeconds = 1_750_000_000L,
            localDate = "2026-06-20",
            utcOffsetMinutes = 330,
            dailyAggregates =
                listOf(
                    CrewDailyAggregate("2026-06-20", focusMinutes = 50, completedWorkBlocks = 2),
                    CrewDailyAggregate("2026-06-19", focusMinutes = 75, completedWorkBlocks = 3),
                ),
            currentStreak = 2,
            lastFocusedAtEpochSeconds = 1_750_000_000L,
        )

    @Test
    public fun encodeEncryptedRoundTripRecoversSnapshotAndHidesPlaintext() {
        val payload = CrewSnapshotCodec.encodeEncrypted(snapshot, crewKey, identity)

        assertFalse(payload.contains("Snehit"))
        assertFalse(payload.contains("allTimeFocusMinutes"))
        assertEquals(snapshot, CrewSnapshotCodec.decodeEncrypted(payload, crewKey))
    }

    @Test
    public fun decodeEncryptedRejectsWrongKeyAndTamperedMetadata() {
        val payload = CrewSnapshotCodec.encodeEncrypted(snapshot, crewKey)
        val envelope = requireNotNull(CrewSnapshotCodec.decodeEnvelope(payload))

        assertNull(CrewSnapshotCodec.decodeEncrypted(payload, "33".repeat(32)))
        assertNull(
            CrewSnapshotCodec.decodeEncrypted(
                gson.toJson(envelope.copy(identityPublicKey = "44".repeat(32))),
                crewKey,
            ),
        )
    }

    @Test
    public fun decodeEncryptedRejectsTamperedCiphertextAndMalformedFields() {
        val payload = CrewSnapshotCodec.encodeEncrypted(snapshot, crewKey)
        val envelope = requireNotNull(CrewSnapshotCodec.decodeEnvelope(payload))

        assertNull(
            CrewSnapshotCodec.decodeEncrypted(
                gson.toJson(envelope.copy(ciphertext = "not-base64")),
                crewKey,
            ),
        )
        assertNull(CrewSnapshotCodec.decodeEncrypted("{\"version\":2}", crewKey))
    }

    @Test
    public fun decodePlaintextRejectsDuplicateDatesUnsafeNamesAndOversizedHistory() {
        val duplicateDates = snapshot.copy(dailyAggregates = snapshot.dailyAggregates + snapshot.dailyAggregates.first())
        val unsafeName = snapshot.copy(displayName = "unsafe\u202ename")
        val oversized =
            snapshot.copy(
                dailyAggregates =
                    (0..30).map {
                        CrewDailyAggregate("2026-05-${(it + 1).toString().padStart(2, '0')}", 1, 1)
                    },
            )

        assertNull(CrewSnapshotCodec.decodePlaintext(gson.toJson(duplicateDates)))
        assertNull(CrewSnapshotCodec.decodePlaintext(gson.toJson(unsafeName)))
        assertNull(CrewSnapshotCodec.decodePlaintext(gson.toJson(oversized)))
    }

    @Test
    public fun decodeEnvelopeKeepsRelayPayloadOpaque() {
        val payload = CrewSnapshotCodec.encodeEncrypted(snapshot, crewKey)
        val envelope = CrewSnapshotCodec.decodeEnvelope(payload)

        assertNotNull(envelope)
        assertEquals(snapshot.crewId, envelope?.crewId)
        assertEquals(snapshot.identityPublicKey, envelope?.identityPublicKey)
    }
}
