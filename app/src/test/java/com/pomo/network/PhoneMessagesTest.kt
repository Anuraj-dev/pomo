package com.pomo.network

import com.google.gson.Gson
import com.google.gson.JsonParser
import com.pomo.timer.TimerState
import org.junit.Assert.assertEquals
import org.junit.Test

public class PhoneMessagesTest {
    private val gson = Gson()

    @Test
    public fun state_wrapsSnapshotInStateEnvelope() {
        val state = TimerState()
        state.status = TimerState.STATUS_RUNNING
        state.phase = TimerState.PHASE_WORK
        state.remaining = 1432.0

        val parsed = JsonParser.parseString(PhoneMessages.state(gson, state, serverTimeSeconds = 99L)).asJsonObject

        assertEquals("state", parsed.get("type").asString)
        assertEquals("running", parsed.getAsJsonObject("data").get("status").asString)
        assertEquals(1432.0, parsed.getAsJsonObject("data").get("remaining").asDouble, 0.0)
        assertEquals(99L, parsed.getAsJsonObject("data").get("server_time").asLong)
    }

    @Test
    public fun statusJson_addsServerTimeAlongsideTimerFields() {
        val state = TimerState()
        state.status = TimerState.STATUS_PAUSED
        state.phase = TimerState.PHASE_SHORT
        state.remaining = 120.0

        val parsed = JsonParser.parseString(PhoneMessages.statusJson(gson, state, 1_700_000_000L)).asJsonObject

        assertEquals("paused", parsed.get("status").asString)
        assertEquals("short", parsed.get("phase").asString)
        assertEquals(120.0, parsed.get("remaining").asDouble, 0.0)
        assertEquals(1_700_000_000L, parsed.get("server_time").asLong)
    }

    @Test
    public fun event_buildsPhaseCompleteEnvelope() {
        val parsed =
            JsonParser.parseString(
                PhoneMessages.event(gson, "phase_complete", TimerState.PHASE_WORK),
            ).asJsonObject

        assertEquals("event", parsed.get("type").asString)
        assertEquals("phase_complete", parsed.get("event").asString)
        assertEquals("work", parsed.get("phase").asString)
    }

    @Test
    public fun event_isDistinguishableFromState() {
        val stateFrame = JsonParser.parseString(PhoneMessages.state(gson, TimerState())).asJsonObject
        val eventFrame =
            JsonParser.parseString(
                PhoneMessages.event(gson, "phase_complete", TimerState.PHASE_SHORT),
            ).asJsonObject

        assertEquals("state", stateFrame.get("type").asString)
        assertEquals("event", eventFrame.get("type").asString)
        assertEquals(false, eventFrame.has("data"))
    }
}
