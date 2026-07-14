package com.pomo.backup

import com.pomo.db.DayStatsEntity
import com.pomo.db.SessionEntity
import com.pomo.timer.TimerState

/**
 * Folds a backup's history into whatever the device already has. Restore is a merge, not an
 * overwrite: someone who reinstalls, focuses for an afternoon, and only then remembers the backup
 * must not lose that afternoon.
 */
public object BackupMerge {

    public data class MergedHistory(
        val dayStats: List<DayStatsEntity>,
        val sessions: List<SessionEntity>,
        val sessionsAdded: Int,
        val daysAffected: Int,
    )

    public fun merge(
        existingDayStats: List<DayStatsEntity>,
        existingSessions: List<SessionEntity>,
        backup: BackupHistory,
        nowMillis: Long = System.currentTimeMillis(),
    ): MergedHistory {
        val byStart = existingSessions.associateByTo(LinkedHashMap()) { it.start }
        var added = 0
        for (session in backup.sessions) {
            // `start` is the primary key, so a session already on the device is the same session.
            // The device's own row wins; only genuinely missing ones come back.
            if (byStart.containsKey(session.start)) continue
            byStart[session.start] = SessionEntity(
                start = session.start,
                date = session.date,
                type = session.type,
                duration = session.duration,
                completed = session.completed,
                synced = true,
            )
            added++
        }
        val sessions = byStart.values.sortedBy { it.start }

        val derived = deriveDayStats(sessions)
        val existingByDate = existingDayStats.associateBy { it.date }
        val backupByDate = backup.dayStats.associateBy { it.date }
        val dates = (derived.keys + existingByDate.keys + backupByDate.keys).sorted()

        val dayStats = dates.map { date ->
            // Day stats are derivable from the sessions of that date, and deriving them is what
            // repairs a day whose sessions were only half present. The stored rows still take part
            // in a field-wise max because history predating per-session rows has no sessions to
            // derive from, and a merge must never subtract.
            val fromSessions = derived[date]
            val fromDevice = existingByDate[date]
            val fromBackup = backupByDate[date]
            DayStatsEntity(
                date = date,
                completed = maxOf(
                    fromSessions?.completed ?: 0,
                    fromDevice?.completed ?: 0,
                    fromBackup?.completed ?: 0,
                ),
                workMinutes = maxOf(
                    fromSessions?.workMinutes ?: 0,
                    fromDevice?.workMinutes ?: 0,
                    fromBackup?.workMinutes ?: 0,
                ),
                breakMinutes = maxOf(
                    fromSessions?.breakMinutes ?: 0,
                    fromDevice?.breakMinutes ?: 0,
                    fromBackup?.breakMinutes ?: 0,
                ),
                lastUpdated = nowMillis,
            )
        }

        val daysAffected = dates.count { date ->
            existingByDate[date]?.let { device ->
                val merged = dayStats.first { it.date == date }
                merged.completed != device.completed ||
                    merged.workMinutes != device.workMinutes ||
                    merged.breakMinutes != device.breakMinutes
            } ?: true
        }

        return MergedHistory(
            dayStats = dayStats,
            sessions = sessions,
            sessionsAdded = added,
            daysAffected = daysAffected,
        )
    }

    /**
     * Rebuilds a day's totals from its sessions, matching how `HistoryDao.insertSessionWithDayStats`
     * accrued them: work minutes are time-honest (a skipped block still contributes minutes), only a
     * completed work block raises the earned count, and part-minutes round up.
     */
    private fun deriveDayStats(sessions: List<SessionEntity>): Map<String, DayStatsEntity> =
        sessions.groupBy { it.date }.mapValues { (date, daySessions) ->
            var completed = 0
            var workMinutes = 0
            var breakMinutes = 0
            for (session in daySessions) {
                val minutes = (session.duration + 59) / 60
                when (session.type) {
                    TimerState.PHASE_WORK -> {
                        workMinutes += minutes
                        if (session.completed) completed++
                    }
                    TimerState.PHASE_SHORT, TimerState.PHASE_LONG ->
                        if (session.completed) breakMinutes += minutes
                }
            }
            DayStatsEntity(
                date = date,
                completed = completed,
                workMinutes = workMinutes,
                breakMinutes = breakMinutes,
            )
        }
}
