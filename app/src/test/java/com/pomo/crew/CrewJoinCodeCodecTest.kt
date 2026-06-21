package com.pomo.crew

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

public class CrewJoinCodeCodecTest {
    @Test
    public fun rawAndUriRoundTripRecoverNormalizedV2Payload() {
        val payload = CrewJoinPayload(
            crewId = "11".repeat(16),
            crewName = "Deep Work",
            relays = listOf("wss://relay.example", "wss://backup.example"),
            key = "22".repeat(32),
        )

        assertEquals(payload, CrewJoinCodeCodec.decode(CrewJoinCodeCodec.encode(payload)))
        assertEquals(payload, CrewJoinCodeCodec.decode(CrewJoinCodeCodec.encodeUri(payload)))
    }

    @Test
    public fun decodeRejectsMalformedLegacyAndUnknownVersionCodes() {
        assertNull(CrewJoinCodeCodec.decode("not-a-crew-code"))
        assertNull(CrewJoinCodeCodec.decode("pomo-crew.v2.not-base64"))
        assertNull(CrewJoinCodeCodec.decode("pomo-crew.legacy"))
        assertTrue(CrewJoinCodeCodec.isLegacy("pomo-crew.legacy"))

        val payload = CrewJoinCodeCodec.newPayload("Deep Work")
        val unknownVersion = CrewJoinCodeCodec.encode(payload).replace("v2", "v3")
        assertNull(CrewJoinCodeCodec.decode(unknownVersion))
    }

    @Test
    public fun newPayloadUsesDefaultsSafeNameAndRandomValues() {
        val first = CrewJoinCodeCodec.newPayload("  Deep   Work  ")
        val second = CrewJoinCodeCodec.newPayload("Deep Work")

        assertEquals("Deep Work", first.crewName)
        assertEquals(CrewDefaults.DEFAULT_RELAYS, first.relays)
        assertNotEquals(first.crewId, second.crewId)
        assertNotEquals(first.key, second.key)
        assertNotNull(CrewJoinCodeCodec.decode(CrewJoinCodeCodec.encode(first)))
    }

    @Test(expected = IllegalArgumentException::class)
    public fun newPayloadRejectsUnsafeCrewName() {
        CrewJoinCodeCodec.newPayload("unsafe\u202ename")
    }
}
