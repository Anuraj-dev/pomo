package com.pomo.network

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.pomo.timer.TimerState

/**
 * Builders for the frames sent over the phone API WebSocket and shared REST
 * status shape helpers.
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
    public const val FIELD_SERVER_TIME: String = "server_time"

    /**
     * REST `GET /api/status` body: all [TimerState] fields plus additive
     * [FIELD_SERVER_TIME] (epoch seconds). Existing clients that ignore
     * unknown fields keep working.
     */
    public fun statusJson(
        gson: Gson,
        state: TimerState,
        serverTimeSeconds: Long,
    ): String {
        val obj = gson.toJsonTree(state).asJsonObject
        obj.addProperty(FIELD_SERVER_TIME, serverTimeSeconds)
        return gson.toJson(obj)
    }

    public fun state(
        gson: Gson,
        state: TimerState,
        serverTimeSeconds: Long = System.currentTimeMillis() / 1000L,
    ): String {
        val data = gson.toJsonTree(state).asJsonObject
        data.addProperty(FIELD_SERVER_TIME, serverTimeSeconds)
        val root = JsonObject()
        root.addProperty("type", TYPE_STATE)
        root.add("data", data)
        return gson.toJson(root)
    }

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
