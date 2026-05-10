// app/src/main/java/com/pomo/db/HistoryCacheRepository.kt
package com.pomo.db

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

public class HistoryCacheRepository(context: Context) {

    public companion object {
        private const val TAG: String = "HistoryCacheRepo"
    }

    private val dao: HistoryDao = AppDatabase.getInstance(context).historyDao()

    public fun observeDayStats(): Flow<List<DayStatsEntity>> = dao.getAllDayStats()

    public fun observeTodayCompletedCount(dayStartHour: Int): Flow<Int> {
        val date = getEffectiveDateString(dayStartHour)
        return dao.getTodayCompletedCountFlow(date)
    }

    public suspend fun getCachedDayStats(): List<DayStatsEntity> = dao.getAllDayStatsSnapshot()

    public suspend fun getHistoryPayload(): Map<String, ServerDayEntry> = withContext(Dispatchers.IO) {
        val days = dao.getAllDayStatsSnapshot()
        val sessionsByDate = if (days.isEmpty()) {
            emptyMap()
        } else {
            dao.getSessionsForDates(days.map { it.date }).groupBy { it.date }
        }

        days.associate { day ->
            day.date to ServerDayEntry(
                completed = day.completed,
                work_minutes = day.workMinutes,
                break_minutes = day.breakMinutes,
                sessions = sessionsByDate[day.date].orEmpty().map {
                    ServerSession(
                        type = it.type,
                        start = it.start,
                        duration = it.duration,
                        completed = it.completed,
                    )
                },
            )
        }
    }

    public suspend fun getSessionsForDate(date: String): List<SessionEntity> =
        dao.getSessionsForDate(date)

    public fun observeSessionsForDate(date: String): Flow<List<SessionEntity>> =
        dao.getSessionsForDateFlow(date)

    public suspend fun saveLocalSession(session: com.pomo.models.Session, dayStartHour: Int) {
        val date = getEffectiveDateString(dayStartHour)
        val entity = SessionEntity(
            start = session.start,
            date = date,
            type = session.type,
            duration = session.duration,
            completed = session.completed,
            synced = true,
        )
        dao.insertSessionWithDayStats(date, entity)
    }

    public suspend fun getTodayCompletedCount(dayStartHour: Int): Int {
        val date = getEffectiveDateString(dayStartHour)
        return dao.getTodayCompletedCount(date)
    }

    public fun getEffectiveDateString(dayStartHour: Int): String {
        val calendar = java.util.Calendar.getInstance()
        if (calendar.get(java.util.Calendar.HOUR_OF_DAY) < dayStartHour) {
            calendar.add(java.util.Calendar.DAY_OF_YEAR, -1)
        }
        val dateFormat = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
        return dateFormat.format(calendar.time)
    }

    public suspend fun clearCache() {
        dao.replaceAllHistory(emptyList(), emptyList())
    }

    public data class ServerDayEntry(
        val completed: Int = 0,
        val work_minutes: Int = 0,
        val break_minutes: Int = 0,
        val sessions: List<ServerSession> = emptyList(),
    )

    public data class ServerSession(
        val type: String = "",
        val start: Long = 0,
        val duration: Int = 0,
        val completed: Boolean = false,
    )

}
