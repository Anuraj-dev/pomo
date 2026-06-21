package com.pomo.crew

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

public class CrewSnapshotSelectionTest {
    @Test
    public fun selectedFocusMinutesUsesDateWindowWhenActivityHasGaps() {
        val today = LocalDate.of(2026, 6, 21)
        val snapshot = CrewSnapshot(
            crewId = "cd".repeat(16),
            identityPublicKey = "01".repeat(32),
            displayName = "Hidden",
            allTimeFocusMinutes = 290,
            publishedAtEpochSeconds = 1_718_927_200L,
            localDate = today.toString(),
            utcOffsetMinutes = 0,
            dailyAggregates = listOf(
                CrewDailyAggregate(localDate = today.toString(), focusMinutes = 90, completedWorkBlocks = 3),
                CrewDailyAggregate(localDate = today.minusDays(7).toString(), focusMinutes = 200, completedWorkBlocks = 8),
            ),
            currentStreak = 1,
            lastFocusedAtEpochSeconds = 1_718_927_200L,
        )

        assertEquals(90, snapshot.selectedFocusMinutes(CrewRankingMode.SevenDays))
        assertEquals(290, snapshot.selectedFocusMinutes(CrewRankingMode.ThirtyDays))
    }
}
