package com.pomo.crew

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

public class CrewRelayTransportTest {
    @Test
    public fun filterValidRelayUrls_rejectsMalformedOverridesAndDedupes() {
        val relays = CrewRelayTransport.filterValidRelayUrls(
            listOf(
                "wss://relay.example",
                "wss://",
                "https://relay.example",
                "not-a-url",
                "wss://relay.example",
            ),
        )

        assertEquals(listOf("wss://relay.example"), relays)
    }

    @Test
    public fun decodeRelayEventVerifiesIdSignatureKindAndCrewTag() {
        val privateKey = CrewNostrKeys.generatePrivateKeyHex()
        val transport = CrewRelayTransport(privateKey)
        val event = transport.signedEvent(CREW_ID, "ciphertext")
        val message = """["EVENT","sub",$event]"""

        val decoded = transport.decodeRelayEvent(message, CREW_ID, "wss://relay.example")

        assertNotNull(decoded)
        assertEquals(CrewNostrKeys.publicKeyHex(privateKey), decoded?.authorPublicKey)
        assertNull(transport.decodeRelayEvent(message, OTHER_CREW_ID, "wss://relay.example"))

        event.addProperty("content", "tampered")
        assertNull(
            transport.decodeRelayEvent(
                """["EVENT","sub",$event]""",
                CREW_ID,
                "wss://relay.example",
            ),
        )
    }

    @Test
    public fun decodeRelayEventRejectsWrongKindAndMalformedSignature() {
        val privateKey = CrewNostrKeys.generatePrivateKeyHex()
        val transport = CrewRelayTransport(privateKey)
        val event = transport.signedEvent(CREW_ID, "ciphertext")

        event.addProperty("kind", CrewDefaults.SNAPSHOT_EVENT_KIND + 1)
        assertNull(transport.decodeRelayEvent("""["EVENT","sub",$event]""", CREW_ID, "wss://relay.example"))

        val validEvent = transport.signedEvent(CREW_ID, "ciphertext")
        validEvent.addProperty("sig", "00")
        assertNull(
            transport.decodeRelayEvent(
                """["EVENT","sub",$validEvent]""",
                CREW_ID,
                "wss://relay.example",
            ),
        )
    }

    private companion object {
        private val CREW_ID: String = "11".repeat(16)
        private val OTHER_CREW_ID: String = "22".repeat(16)
    }
}
