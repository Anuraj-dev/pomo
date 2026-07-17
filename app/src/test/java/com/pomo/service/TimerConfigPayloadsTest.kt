package com.pomo.service

import org.junit.Assert.assertEquals
import org.junit.Test

public class TimerConfigPayloadsTest {
    private val current =
        TimerConfigPayloads.Values(
            work = 25,
            shortBreak = 5,
            longBreak = 15,
            longBreakAfter = 4,
            dailyGoal = 8,
        )

    @Test
    public fun parseAndMerge_emptyPayloadKeepsCurrentValues() {
        assertEquals(current, TimerConfigPayloads.parseAndMerge("{}", current))
    }

    @Test
    public fun parseAndMerge_partialDurationsOnlyUpdatesProvidedFields() {
        val merged =
            TimerConfigPayloads.parseAndMerge(
                """{"durations":{"work":30}}""",
                current,
            )

        assertEquals(
            current.copy(work = 30),
            merged,
        )
    }

    @Test
    public fun parseAndMerge_invalidValuesAreIgnored() {
        val merged =
            TimerConfigPayloads.parseAndMerge(
                """
                {
                  "durations": {
                    "work": 0,
                    "short_break": -1,
                    "long_break": 20
                  },
                  "long_break_after": 0,
                  "daily_goal": -1
                }
                """.trimIndent(),
                current,
            )

        assertEquals(
            current.copy(longBreak = 20),
            merged,
        )
    }

    @Test
    public fun parseAndMerge_legacyDayStartHourIsIgnored() {
        val merged =
            TimerConfigPayloads.parseAndMerge(
                """{"day_start_hour":23,"daily_goal":10}""",
                current,
            )

        assertEquals(current.copy(dailyGoal = 10), merged)
    }

    @Test(expected = IllegalArgumentException::class)
    public fun parseAndMerge_jsonNullIsRejected() {
        TimerConfigPayloads.parseAndMerge("null", current)
    }

    @Test(expected = Exception::class)
    public fun parseAndMerge_malformedJsonIsRejected() {
        TimerConfigPayloads.parseAndMerge("{not json", current)
    }
}
