package com.pomo.crew

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

public class CrewLeaderboardAggregatorTest {
    private val nowDate: LocalDate = LocalDate.of(2026, 6, 20)
    private val now: Long = nowDate.atStartOfDay().toEpochSecond(ZoneOffset.UTC) + 12 * 60 * 60

    @Test
    public fun rankUsesCompetitionRanksAndLeavesZeroTotalsUnranked() {
        val rows = CrewLeaderboardAggregator.rank(
            crewId = CREW_ID,
            selfIdentityPublicKey = identity(1),
            snapshots = listOf(
                snapshot(identity(1), "Me", allTime = 90),
                snapshot(identity(2), "Asha", allTime = 120),
                snapshot(identity(3), "Bo", allTime = 120),
                snapshot(identity(4), "Zero", allTime = 0),
            ),
            nowEpochSeconds = now,
        )

        assertEquals(listOf("Asha", "Bo", "Me", "Zero"), rows.map { it.displayName })
        assertEquals(listOf(1, 1, 3, null), rows.map { it.rank })
        assertTrue(rows.first { it.displayName == "Me" }.isSelf)
    }

    @Test
    public fun rankingWindowsUseMemberLocalDatedAggregates() {
        val rowsToday = CrewLeaderboardAggregator.rank(
            crewId = CREW_ID,
            selfIdentityPublicKey = identity(1),
            snapshots = listOf(
                snapshot(identity(1), "Me", allTime = 500, dailyMinutes = (0..29).associate { it to 1 }),
                snapshot(identity(2), "Friend", allTime = 50, dailyMinutes = mapOf(0 to 90, 7 to 200)),
            ),
            mode = CrewRankingMode.Today,
            nowEpochSeconds = now,
        )
        val rowsSevenDays = CrewLeaderboardAggregator.rank(
            crewId = CREW_ID,
            selfIdentityPublicKey = identity(1),
            snapshots = rowsToday.mapNotNull { row ->
                listOf(
                    snapshot(identity(1), "Me", allTime = 500, dailyMinutes = (0..29).associate { it to 1 }),
                    snapshot(identity(2), "Friend", allTime = 50, dailyMinutes = mapOf(0 to 90, 7 to 200)),
                ).firstOrNull { it.identityPublicKey == row.identityPublicKey }
            },
            mode = CrewRankingMode.SevenDays,
            nowEpochSeconds = now,
        )

        assertEquals(listOf("Friend", "Me"), rowsToday.map { it.displayName })
        assertEquals(90, rowsToday.first().todayFocusMinutes)
        assertEquals(90, rowsSevenDays.first().sevenDayFocusMinutes)
        assertEquals(7, rowsSevenDays.last().sevenDayFocusMinutes)
    }

    @Test
    public fun rankKeepsLatestSnapshotAndSeparatesStaleFromInactive() {
        val snapshots = listOf(
            snapshot(identity(1), "Old", allTime = 500, publishedAt = now - 1),
            snapshot(identity(1), "Fresh", allTime = 10, publishedAt = now),
            snapshot(identity(2), "Stale", allTime = 90, lastFocusedAt = now - 8 * DAY_SECONDS),
            snapshot(identity(3), "Inactive", allTime = 900, lastFocusedAt = now - 31 * DAY_SECONDS),
        )

        val rows = CrewLeaderboardAggregator.rank(
            crewId = CREW_ID,
            selfIdentityPublicKey = identity(1),
            snapshots = snapshots,
            nowEpochSeconds = now,
        )

        assertEquals(listOf("Stale", "Fresh", "Inactive"), rows.map { it.displayName })
        assertTrue(rows.first().isStale)
        assertFalse(rows.first().isInactive)
        assertTrue(rows.last().isInactive)
        assertNull(rows.last().rank)
    }

    @Test
    public fun rankHandlesFiveHundredMembersWithoutDroppingOrderOrSelf() {
        val snapshots = (1..500).map { index ->
            snapshot(
                identity = identity(index),
                name = "Member $index",
                allTime = 1_000 - index,
                dailyMinutes = mapOf(0 to (index % 180) + 1),
            )
        }

        val rows = CrewLeaderboardAggregator.rank(
            crewId = CREW_ID,
            selfIdentityPublicKey = identity(250),
            snapshots = snapshots,
            mode = CrewRankingMode.AllTime,
            nowEpochSeconds = now,
        )

        assertEquals(500, rows.size)
        assertEquals("Member 1", rows.first().displayName)
        assertEquals("Member 500", rows.last().displayName)
        assertTrue(rows.single { it.identityPublicKey == identity(250) }.isSelf)
        assertEquals((1..500).toList(), rows.mapNotNull { it.rank })
    }

    private fun snapshot(
        identity: String,
        name: String,
        allTime: Int,
        dailyMinutes: Map<Int, Int> = mapOf(0 to allTime),
        publishedAt: Long = now,
        lastFocusedAt: Long = now,
    ): CrewSnapshot = CrewSnapshot(
        crewId = CREW_ID,
        identityPublicKey = identity,
        displayName = name,
        allTimeFocusMinutes = allTime,
        publishedAtEpochSeconds = publishedAt,
        localDate = nowDate.toString(),
        utcOffsetMinutes = 0,
        dailyAggregates = dailyMinutes.entries
            .map { (daysAgo, minutes) ->
                CrewDailyAggregate(nowDate.minusDays(daysAgo.toLong()).toString(), minutes, minutes / 25)
            }
            .sortedByDescending { it.localDate },
        currentStreak = 1,
        lastFocusedAtEpochSeconds = lastFocusedAt,
    )

    private fun identity(index: Int): String = index.toString(16).padStart(64, '0')

    private companion object {
        private val CREW_ID: String = "11".repeat(16)
        private const val DAY_SECONDS: Long = 24L * 60L * 60L
    }
}
