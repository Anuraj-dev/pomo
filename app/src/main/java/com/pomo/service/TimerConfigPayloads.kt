package com.pomo.service

import com.google.gson.Gson

public object TimerConfigPayloads {
    private val gson = Gson()

    public fun parseAndMerge(body: String, current: Values): Values {
        val payload = gson.fromJson(body, PartialPayload::class.java)
            ?: throw IllegalArgumentException("config body must be a JSON object")
        return Values(
            work = payload.durations?.work?.takeIf { it > 0 } ?: current.work,
            shortBreak = payload.durations?.short_break?.takeIf { it > 0 } ?: current.shortBreak,
            longBreak = payload.durations?.long_break?.takeIf { it > 0 } ?: current.longBreak,
            longBreakAfter = payload.long_break_after?.takeIf { it > 0 } ?: current.longBreakAfter,
            dailyGoal = payload.daily_goal?.takeIf { it >= 0 } ?: current.dailyGoal,
        )
    }

    public data class Values(
        val work: Int,
        val shortBreak: Int,
        val longBreak: Int,
        val longBreakAfter: Int,
        val dailyGoal: Int,
    )

    public data class PartialPayload(
        val durations: PartialDurations?,
        val long_break_after: Int?,
        val daily_goal: Int?,
    )

    public data class PartialDurations(
        val work: Int?,
        val short_break: Int?,
        val long_break: Int?,
    )
}
