package com.pomo.network

import com.google.gson.Gson
import com.pomo.timer.TimerState

/**
 * Builders for the frames sent over the phone API WebSocket.
 *
 * Kept free of Ktor and Android types so frame shape is unit-testable without
 * standing up a server. Clients are contractually required to ignore frames
 * whose `type` they do not recognise, which is what makes adding new event
 * types backward-compatible.
 */
public object PhoneMessages {
    public const val TYPE_STATE: String = "state"
    public const val TYPE_EVENT: String = "event"
    public const val EVENT_PHASE_COMPLETE: String = "phase_complete"

    public fun state(
        gson: Gson,
        state: TimerState,
    ): String =
        gson.toJson(
            mapOf(
                "type" to TYPE_STATE,
                "data" to state,
            ),
        )

    public fun event(
        gson: Gson,
        event: String,
        phase: String,
    ): String =
        gson.toJson(
            mapOf(
                "type" to TYPE_EVENT,
                "event" to event,
                "phase" to phase,
            ),
        )
}
