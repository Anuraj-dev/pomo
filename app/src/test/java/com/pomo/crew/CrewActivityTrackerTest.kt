package com.pomo.crew

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

public class CrewActivityTrackerTest {
    private val today: LocalDate = LocalDate.of(2026, 6, 21)
    private val now: Long = 1_781_000_000L
    private val selfKey: String = "ff".repeat(32)

    @Test
    public fun aFreshStartFromACrewMateIsAnnounced() {
        val tracker = CrewActivityTracker(selfKey)

        val events = tracker.observe(snapshot(presence = presence(startedAt = now - 30L)), now)

        val started = events.single() as CrewActivityEvent.StartedFocus
        assertEquals("Ira", started.displayName)
    }

    @Test
    public fun ourOwnSnapshotNeverNotifiesUs() {
        val tracker = CrewActivityTracker(selfKey)

        val events = tracker.observe(
            snapshot(identityPublicKey = selfKey, presence = presence(startedAt = now - 30L)),
            now,
        )

        assertTrue(events.isEmpty())
    }

    @Test
    public fun aRepeatedSnapshotOfTheSameSessionStaysQuiet() {
        val tracker = CrewActivityTracker(selfKey)
        val live = snapshot(presence = presence(startedAt = now - 30L))

        assertEquals(1, tracker.observe(live, now).size)
        assertTrue(tracker.observe(live, now + 10L).isEmpty())
    }

    @Test
    public fun aSessionThatBeganLongAgoIsHistoryNotNews() {
        val tracker = CrewActivityTracker(selfKey)
        val stale = snapshot(presence = presence(startedAt = now - 40L * 60L, lengthSeconds = 50L * 60L))

        assertTrue(tracker.observe(stale, now).isEmpty())
    }

    @Test
    public fun aBlockCountThatGrowsAnnouncesACompletedBlock() {
        val tracker = CrewActivityTracker(selfKey)
        tracker.seed(listOf(row(workBlocks = 3)))

        val events = tracker.observe(snapshot(workBlocks = 4), now)

        val completed = events.single() as CrewActivityEvent.CompletedBlock
        assertEquals(4, completed.todayWorkBlocks)
    }

    @Test
    public fun aSeededMemberDoesNotReannounceBlocksWeAlreadyKnewAbout() {
        val tracker = CrewActivityTracker(selfKey)
        tracker.seed(listOf(row(workBlocks = 3)))

        assertTrue(tracker.observe(snapshot(workBlocks = 3), now).isEmpty())
    }

    private fun presence(startedAt: Long, lengthSeconds: Long = 25L * 60L): CrewPresence = CrewPresence(
        phase = CrewPresence.PHASE_WORK,
        startedAtEpochSeconds = startedAt,
        endsAtEpochSeconds = startedAt + lengthSeconds,
    )

    private fun row(workBlocks: Int): CrewBoardRow = CrewBoardRow(
        rank = 1,
        identityPublicKey = "01".repeat(32),
        displayName = "Ira",
        allTimeFocusMinutes = 500,
        todayFocusMinutes = 90,
        sevenDayFocusMinutes = 90,
        thirtyDayFocusMinutes = 90,
        selectedFocusMinutes = 90,
        currentStreak = 4,
        todaySessionCount = workBlocks,
        lastFocusedAtEpochSeconds = now,
        dailyAggregates = emptyList(),
        isSelf = false,
        localDate = today.toString(),
    )

    private fun snapshot(
        identityPublicKey: String = "01".repeat(32),
        workBlocks: Int = 3,
        presence: CrewPresence? = null,
    ): CrewSnapshot = CrewSnapshot(
        crewId = "cd".repeat(16),
        identityPublicKey = identityPublicKey,
        displayName = "Ira",
        allTimeFocusMinutes = 500,
        publishedAtEpochSeconds = now,
        localDate = today.toString(),
        utcOffsetMinutes = 0,
        dailyAggregates = listOf(
            CrewDailyAggregate(
                localDate = today.toString(),
                focusMinutes = 90,
                completedWorkBlocks = workBlocks,
            ),
        ),
        currentStreak = 4,
        lastFocusedAtEpochSeconds = now,
        presence = presence,
    )
}
