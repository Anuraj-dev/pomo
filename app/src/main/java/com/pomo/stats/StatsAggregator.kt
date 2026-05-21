package com.pomo.stats

import com.pomo.db.DayStatsEntity
import com.pomo.db.SessionEntity
import com.pomo.util.DateLogic
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

public object StatsAggregator {

    private const val DATE_PATTERN: String = "yyyy-MM-dd"
    private const val HABIT_WEEKS: Int = 12
    private const val GOAL_WINDOW_DAYS: Int = 30
    private const val WORK_TYPE: String = "work"

    /**
     * Aggregate a [StatsSnapshot] from raw Room data. Pure: no Android, no clock.
     * Caller passes [nowMs] (used for streak anchoring) and [today] (the effective
     * calendar date string the rest of the app is using).
     */
    public fun aggregate(
        days: List<DayStatsEntity>,
        sessions: List<SessionEntity>,
        dailyGoal: Int,
        today: String,
        nowMs: Long,
        tz: TimeZone = TimeZone.getDefault(),
    ): StatsSnapshot {
        if (days.isEmpty() && sessions.isEmpty()) {
            return StatsSnapshot.Empty.copy(
                goal = GoalSummary(dailyGoal = dailyGoal, daysHit = 0, totalDays = 0),
                habit = HabitWindow(
                    weeks = HABIT_WEEKS,
                    cells = buildEmptyHabitCells(today, HABIT_WEEKS, tz),
                    currentStreak = 0,
                    bestStreak = 0,
                ),
            )
        }

        val workSessions = sessions.filter { it.type == WORK_TYPE && it.completed }
        val dayByDate = days.associateBy { it.date }

        val lifetime = computeLifetime(days, today, tz)
        val rhythm = computeHourRhythm(workSessions, tz)
        val weekShape = computeWeekShape(workSessions, tz)
        val habit = computeHabitWindow(dayByDate, today, nowMs, tz)
        val goal = computeGoalSummary(dayByDate, today, dailyGoal, tz)
        val records = computeRecords(days, habit.bestStreak)

        return StatsSnapshot(
            lifetime = lifetime,
            rhythm = rhythm,
            weekShape = weekShape,
            habit = habit,
            goal = goal,
            records = records,
        )
    }

    private fun computeLifetime(
        days: List<DayStatsEntity>,
        today: String,
        tz: TimeZone,
    ): Lifetime {
        if (days.isEmpty()) return Lifetime(0, 0, 0, null)
        var minutes = 0
        var sessions = 0
        var earliest: String? = null
        for (d in days) {
            minutes += d.workMinutes
            sessions += d.completed
            if (d.completed > 0 && (earliest == null || d.date < earliest)) {
                earliest = d.date
            }
        }
        val daysSpan = earliest?.let { inclusiveDayCount(it, today, tz) } ?: 0
        return Lifetime(
            focusMinutes = minutes,
            sessions = sessions,
            daysWithApp = daysSpan,
            firstDate = earliest,
        )
    }

    private fun computeHourRhythm(
        workSessions: List<SessionEntity>,
        tz: TimeZone,
    ): HourRhythm {
        val buckets = IntArray(24)
        if (workSessions.isEmpty()) {
            return HourRhythm(buckets, null, RhythmPattern.None)
        }
        val cal = Calendar.getInstance(tz)
        for (s in workSessions) {
            // SessionEntity.start is epoch SECONDS; convert to ms.
            cal.time = Date(s.start * 1000L)
            val h = cal.get(Calendar.HOUR_OF_DAY)
            val minutes = (s.duration + 59) / 60
            buckets[h] += minutes.coerceAtLeast(1)
        }
        val total = buckets.sum()
        if (total == 0) return HourRhythm(buckets, null, RhythmPattern.None)
        val peak = buckets.indices.maxBy { buckets[it] }
        val pattern = classifyPattern(buckets, peak, total)
        return HourRhythm(buckets, peak, pattern)
    }

    private fun classifyPattern(buckets: IntArray, peak: Int, total: Int): RhythmPattern {
        // Concentration: top-3 hours share of total. < 45% → scattered.
        val sorted = buckets.toList().sortedDescending().take(3).sum()
        val concentration = sorted.toFloat() / total
        if (concentration < 0.45f) return RhythmPattern.Scattered
        return when (peak) {
            in 5..11 -> RhythmPattern.Morning
            in 12..16 -> RhythmPattern.Afternoon
            in 17..20 -> RhythmPattern.Evening
            else -> RhythmPattern.Night
        }
    }

    private fun computeWeekShape(
        workSessions: List<SessionEntity>,
        tz: TimeZone,
    ): WeekShape {
        val buckets = IntArray(7) // 0 = Monday, 6 = Sunday
        if (workSessions.isEmpty()) return WeekShape(buckets, null)
        val cal = Calendar.getInstance(tz)
        for (s in workSessions) {
            cal.time = Date(s.start * 1000L)
            val dow = cal.get(Calendar.DAY_OF_WEEK) // Sun=1..Sat=7
            val idx = (dow + 5) % 7 // Mon=0..Sun=6
            val minutes = (s.duration + 59) / 60
            buckets[idx] += minutes.coerceAtLeast(1)
        }
        if (buckets.sum() == 0) return WeekShape(buckets, null)
        val strongest = buckets.indices.maxBy { buckets[it] }
        return WeekShape(buckets, strongest)
    }

    private fun computeHabitWindow(
        dayByDate: Map<String, DayStatsEntity>,
        today: String,
        nowMs: Long,
        tz: TimeZone,
    ): HabitWindow {
        val df = SimpleDateFormat(DATE_PATTERN, Locale.US).apply { timeZone = tz }
        val todayDate = df.parse(today) ?: return HabitWindow(HABIT_WEEKS, emptyList(), 0, 0)
        val start = Calendar.getInstance(tz).apply {
            time = todayDate
            add(Calendar.WEEK_OF_YEAR, -(HABIT_WEEKS - 1))
            set(Calendar.DAY_OF_WEEK, Calendar.SUNDAY)
        }
        val cells = mutableListOf<HeatCell>()
        val iter = start.clone() as Calendar
        for (w in 0 until HABIT_WEEKS) {
            for (d in 0 until 7) {
                if (iter.time.after(todayDate)) break
                val key = df.format(iter.time)
                val entry = dayByDate[key]
                cells += HeatCell(
                    date = key,
                    sessions = entry?.completed ?: 0,
                    minutes = entry?.workMinutes ?: 0,
                )
                iter.add(Calendar.DAY_OF_YEAR, 1)
            }
        }
        val activeDates = dayByDate.values
            .filter { it.completed > 0 }
            .map { it.date }
            .toSet()
        return HabitWindow(
            weeks = HABIT_WEEKS,
            cells = cells,
            currentStreak = DateLogic.currentStreak(activeDates, nowMs, tz),
            bestStreak = DateLogic.bestStreak(activeDates),
        )
    }

    private fun computeGoalSummary(
        dayByDate: Map<String, DayStatsEntity>,
        today: String,
        dailyGoal: Int,
        tz: TimeZone,
    ): GoalSummary {
        if (dailyGoal <= 0) return GoalSummary(dailyGoal = 0, daysHit = 0, totalDays = 0)
        val df = SimpleDateFormat(DATE_PATTERN, Locale.US).apply { timeZone = tz }
        val todayDate = df.parse(today) ?: return GoalSummary(dailyGoal, 0, 0)
        val iter = Calendar.getInstance(tz).apply {
            time = todayDate
            add(Calendar.DAY_OF_YEAR, -(GOAL_WINDOW_DAYS - 1))
        }
        var hit = 0
        repeat(GOAL_WINDOW_DAYS) {
            val key = df.format(iter.time)
            val completed = dayByDate[key]?.completed ?: 0
            if (completed >= dailyGoal) hit++
            iter.add(Calendar.DAY_OF_YEAR, 1)
        }
        return GoalSummary(dailyGoal = dailyGoal, daysHit = hit, totalDays = GOAL_WINDOW_DAYS)
    }

    private fun computeRecords(
        days: List<DayStatsEntity>,
        bestStreak: Int,
    ): Records {
        val bestDay = days
            .filter { it.completed > 0 }
            .maxByOrNull { it.completed }
            ?.let { BestDay(date = it.date, sessions = it.completed) }

        // Best week: group sessions by Sunday-anchored week (week start = Sunday).
        val bestWeek = if (days.isEmpty()) null else computeBestWeek(days)

        return Records(bestDay = bestDay, bestWeek = bestWeek, longestStreak = bestStreak)
    }

    private fun computeBestWeek(days: List<DayStatsEntity>): BestWeek? {
        val df = SimpleDateFormat(DATE_PATTERN, Locale.US)
        val cal = Calendar.getInstance()
        val grouped = HashMap<String, Int>()
        for (d in days) {
            val date = df.parse(d.date) ?: continue
            cal.time = date
            // Snap to Sunday of that week.
            val dow = cal.get(Calendar.DAY_OF_WEEK) // Sun=1
            cal.add(Calendar.DAY_OF_YEAR, -(dow - Calendar.SUNDAY))
            val key = df.format(cal.time)
            grouped[key] = (grouped[key] ?: 0) + d.completed
        }
        val (weekStart, sessions) = grouped.maxByOrNull { it.value } ?: return null
        if (sessions == 0) return null
        return BestWeek(weekStart = weekStart, sessions = sessions)
    }

    private fun inclusiveDayCount(fromDate: String, toDate: String, tz: TimeZone): Int {
        val df = SimpleDateFormat(DATE_PATTERN, Locale.US).apply { timeZone = tz }
        val from = df.parse(fromDate) ?: return 0
        val to = df.parse(toDate) ?: return 0
        val days = (to.time - from.time) / (1000L * 60 * 60 * 24)
        return (days.toInt() + 1).coerceAtLeast(1)
    }

    private fun buildEmptyHabitCells(today: String, weeks: Int, tz: TimeZone): List<HeatCell> {
        val df = SimpleDateFormat(DATE_PATTERN, Locale.US).apply { timeZone = tz }
        val todayDate = df.parse(today) ?: return emptyList()
        val start = Calendar.getInstance(tz).apply {
            time = todayDate
            add(Calendar.WEEK_OF_YEAR, -(weeks - 1))
            set(Calendar.DAY_OF_WEEK, Calendar.SUNDAY)
        }
        val cells = mutableListOf<HeatCell>()
        val iter = start.clone() as Calendar
        for (w in 0 until weeks) {
            for (d in 0 until 7) {
                if (iter.time.after(todayDate)) break
                cells += HeatCell(date = df.format(iter.time), sessions = 0, minutes = 0)
                iter.add(Calendar.DAY_OF_YEAR, 1)
            }
        }
        return cells
    }
}
