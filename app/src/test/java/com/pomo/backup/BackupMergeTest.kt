package com.pomo.backup

import com.pomo.db.DayStatsEntity
import com.pomo.db.SessionEntity
import com.pomo.timer.TimerState
import org.junit.Assert.assertEquals
import org.junit.Test

public class BackupMergeTest {
    private fun work(
        start: Long,
        date: String,
        minutes: Int,
        completed: Boolean = true,
    ) = SessionEntity(
        start = start,
        date = date,
        type = TimerState.PHASE_WORK,
        duration = minutes * 60,
        completed = completed,
    )

    private fun backupWork(
        start: Long,
        date: String,
        minutes: Int,
        completed: Boolean = true,
    ) = BackupSession(
        start = start,
        date = date,
        type = TimerState.PHASE_WORK,
        duration = minutes * 60,
        completed = completed,
    )

    @Test
    public fun `restores history into an empty device`() {
        val merged =
            BackupMerge.merge(
                existingDayStats = emptyList(),
                existingSessions = emptyList(),
                backup =
                    BackupHistory(
                        dayStats = listOf(BackupDayStats("2026-07-01", completed = 2, workMinutes = 50)),
                        sessions =
                            listOf(
                                backupWork(1_000L, "2026-07-01", 25),
                                backupWork(3_000L, "2026-07-01", 25),
                            ),
                    ),
            )

        assertEquals(2, merged.sessionsAdded)
        assertEquals(2, merged.sessions.size)
        val day = merged.dayStats.single()
        assertEquals("2026-07-01", day.date)
        assertEquals(2, day.completed)
        assertEquals(50, day.workMinutes)
    }

    @Test
    public fun `keeps focus logged after the reinstall and before the restore`() {
        val merged =
            BackupMerge.merge(
                existingDayStats = listOf(DayStatsEntity("2026-07-02", completed = 1, workMinutes = 25, breakMinutes = 0)),
                existingSessions = listOf(work(9_000L, "2026-07-02", 25)),
                backup =
                    BackupHistory(
                        dayStats = listOf(BackupDayStats("2026-07-01", completed = 1, workMinutes = 25)),
                        sessions = listOf(backupWork(1_000L, "2026-07-01", 25)),
                    ),
            )

        assertEquals(1, merged.sessionsAdded)
        assertEquals(listOf(1_000L, 9_000L), merged.sessions.map { it.start })
        assertEquals(2, merged.dayStats.size)
        assertEquals(25, merged.dayStats.first { it.date == "2026-07-02" }.workMinutes)
    }

    @Test
    public fun `a session already on the device is not counted twice`() {
        val merged =
            BackupMerge.merge(
                existingDayStats = listOf(DayStatsEntity("2026-07-01", completed = 1, workMinutes = 25, breakMinutes = 0)),
                existingSessions = listOf(work(1_000L, "2026-07-01", 25)),
                backup =
                    BackupHistory(
                        dayStats = listOf(BackupDayStats("2026-07-01", completed = 1, workMinutes = 25)),
                        sessions = listOf(backupWork(1_000L, "2026-07-01", 25)),
                    ),
            )

        assertEquals(0, merged.sessionsAdded)
        assertEquals(1, merged.sessions.size)
        assertEquals(1, merged.dayStats.single().completed)
        assertEquals(25, merged.dayStats.single().workMinutes)
    }

    @Test
    public fun `a skipped work block gives its minutes but earns no block`() {
        val merged =
            BackupMerge.merge(
                existingDayStats = emptyList(),
                existingSessions = emptyList(),
                backup =
                    BackupHistory(
                        sessions =
                            listOf(
                                backupWork(1_000L, "2026-07-01", 25),
                                backupWork(3_000L, "2026-07-01", 7, completed = false),
                            ),
                    ),
            )

        val day = merged.dayStats.single()
        assertEquals(1, day.completed)
        assertEquals(32, day.workMinutes)
    }

    @Test
    public fun `only completed breaks count towards break minutes`() {
        val merged =
            BackupMerge.merge(
                existingDayStats = emptyList(),
                existingSessions = emptyList(),
                backup =
                    BackupHistory(
                        sessions =
                            listOf(
                                BackupSession(1_000L, "2026-07-01", TimerState.PHASE_SHORT, 5 * 60, completed = true),
                                BackupSession(2_000L, "2026-07-01", TimerState.PHASE_LONG, 15 * 60, completed = false),
                            ),
                    ),
            )

        assertEquals(5, merged.dayStats.single().breakMinutes)
        assertEquals(0, merged.dayStats.single().workMinutes)
    }

    @Test
    public fun `day stats with no sessions to derive from survive the merge`() {
        val merged =
            BackupMerge.merge(
                existingDayStats = emptyList(),
                existingSessions = emptyList(),
                backup =
                    BackupHistory(
                        dayStats = listOf(BackupDayStats("2026-06-01", completed = 4, workMinutes = 100, breakMinutes = 20)),
                        sessions = emptyList(),
                    ),
            )

        val day = merged.dayStats.single()
        assertEquals(4, day.completed)
        assertEquals(100, day.workMinutes)
        assertEquals(20, day.breakMinutes)
    }

    @Test
    public fun `part minutes round up exactly as the timer records them`() {
        val merged =
            BackupMerge.merge(
                existingDayStats = emptyList(),
                existingSessions = emptyList(),
                backup =
                    BackupHistory(
                        sessions =
                            listOf(
                                BackupSession(1_000L, "2026-07-01", TimerState.PHASE_WORK, 61, completed = false),
                            ),
                    ),
            )

        assertEquals(2, merged.dayStats.single().workMinutes)
    }
}
