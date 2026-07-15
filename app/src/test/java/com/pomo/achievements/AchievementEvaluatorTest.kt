package com.pomo.achievements

import com.pomo.stats.BestDay
import com.pomo.stats.Records
import com.pomo.stats.StatsSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class AchievementEvaluatorTest {

    private fun snapshot(
        focusMinutes: Int = 0,
        sessions: Int = 0,
        bestStreak: Int = 0,
        bestDayMinutes: Int = 0,
    ): StatsSnapshot = StatsSnapshot.Empty.copy(
        lifetime = StatsSnapshot.Empty.lifetime.copy(focusMinutes = focusMinutes, sessions = sessions),
        records = Records(
            bestDay = if (bestDayMinutes > 0) BestDay("2026-01-01", 0, bestDayMinutes) else null,
            bestWeek = null,
            longestStreak = bestStreak,
        ),
    )

    private fun earnedIds(snapshot: StatsSnapshot): Set<String> =
        AchievementEvaluator.earnedOnly(snapshot).map { it.id }.toSet()

    @Test
    public fun `empty history earns nothing`() {
        assertEquals(emptySet<String>(), earnedIds(StatsSnapshot.Empty))
        assertEquals(0, AchievementEvaluator.earnedCount(StatsSnapshot.Empty))
    }

    @Test
    public fun `the catalog is the agreed sixteen`() {
        assertEquals(16, AchievementCatalog.size)
    }

    @Test
    public fun `a single work block earns Block one and nothing else`() {
        val earned = earnedIds(snapshot(focusMinutes = 5, sessions = 1))
        assertTrue("milestone_first_block" in earned)
        assertFalse("focus_1h" in earned)
        assertEquals(setOf("milestone_first_block"), earned)
    }

    @Test
    public fun `focus is exactly at threshold, not one minute under`() {
        assertFalse("focus_100h" in earnedIds(snapshot(focusMinutes = 100 * 60 - 1)))
        assertTrue("focus_100h" in earnedIds(snapshot(focusMinutes = 100 * 60)))
    }

    @Test
    public fun `achievements are monotonic — they read all-time maxima, not today`() {
        // A best streak of 30 stays earned even though the snapshot's *current* streak is broken:
        // the evaluator only ever looks at records.longestStreak.
        val earned = earnedIds(snapshot(bestStreak = 30))
        assertTrue("streak_3d" in earned)
        assertTrue("streak_7d" in earned)
        assertTrue("streak_30d" in earned)
        assertFalse("streak_100d" in earned)
    }

    @Test
    public fun `best day ladder is capped at eight hours`() {
        // A 16-hour day earns the two rungs and no more — there is deliberately nothing above 8h.
        val axisIds = AchievementCatalog.all
            .filter { it.axis == AchievementAxis.BestDay }
            .map { it.id }
            .toSet()
        assertEquals(setOf("day_4h", "day_8h"), axisIds)
        assertEquals(setOf("day_4h", "day_8h"), earnedIds(snapshot(bestDayMinutes = 16 * 60)))
    }

    @Test
    public fun `no tile is earned by the calendar alone`() {
        // Every threshold is crossed by doing something (minutes, days of streak, a block), never by
        // elapsed tenure. Proven structurally: a snapshot with real focus history but a first-focus
        // date years ago earns exactly the tiles its numbers clear, with no bonus for age.
        val young = snapshot(focusMinutes = 60, sessions = 1, bestStreak = 3, bestDayMinutes = 60)
        val old = young.copy(lifetime = young.lifetime.copy(firstDate = "2000-01-01", daysWithApp = 9000))
        assertEquals(earnedIds(young), earnedIds(old))
    }

    @Test
    public fun `highlights shows the furthest rung on each ladder`() {
        val snap = snapshot(focusMinutes = 500 * 60, sessions = 100, bestStreak = 30, bestDayMinutes = 8 * 60)
        assertEquals(
            listOf("focus_500h", "streak_30d", "day_8h"),
            AchievementEvaluator.highlights(snap).map { it.id },
        )
    }

    @Test
    public fun `highlights never leaves a fresh member with an empty row`() {
        assertEquals(
            listOf("milestone_first_block"),
            AchievementEvaluator.highlights(snapshot(focusMinutes = 2, sessions = 1)).map { it.id },
        )
    }
}
