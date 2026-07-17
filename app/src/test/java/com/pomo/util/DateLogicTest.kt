package com.pomo.util

import org.junit.Assert.assertEquals
import org.junit.Test
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

public class DateLogicTest {
    private val utc: TimeZone = TimeZone.getTimeZone("UTC")
    private val isoDateTime = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = utc }

    private fun ms(iso: String): Long = isoDateTime.parse(iso)!!.time

    @Test
    public fun effectiveDate_returnsLocalCalendarDate() {
        assertEquals("2026-05-07", DateLogic.effectiveDate(ms("2026-05-07T10:00:00"), utc))
    }

    @Test
    public fun effectiveDate_afterMidnight_returnsNewDay() {
        assertEquals("2026-05-07", DateLogic.effectiveDate(ms("2026-05-07T00:30:00"), utc))
    }

    @Test
    public fun currentStreak_emptyHistory_isZero() {
        assertEquals(0, DateLogic.currentStreak(emptySet(), ms("2026-05-07T10:00:00"), utc))
    }

    @Test
    public fun currentStreak_todayActive_extendsToToday() {
        val active = setOf("2026-05-07", "2026-05-06", "2026-05-05")
        assertEquals(3, DateLogic.currentStreak(active, ms("2026-05-07T10:00:00"), utc))
    }

    @Test
    public fun currentStreak_todayInactive_fallsBackToYesterday() {
        // Today (2026-05-07) inactive, but yesterday and prior are active → 2
        val active = setOf("2026-05-06", "2026-05-05")
        assertEquals(2, DateLogic.currentStreak(active, ms("2026-05-07T10:00:00"), utc))
    }

    @Test
    public fun currentStreak_gap_breaksStreak() {
        // Yesterday active, day before missing → only 1
        val active = setOf("2026-05-06", "2026-05-04")
        assertEquals(1, DateLogic.currentStreak(active, ms("2026-05-07T10:00:00"), utc))
    }

    @Test
    public fun bestStreak_empty_isZero() {
        assertEquals(0, DateLogic.bestStreak(emptySet()))
    }

    @Test
    public fun bestStreak_single_isOne() {
        assertEquals(1, DateLogic.bestStreak(setOf("2026-05-01")))
    }

    @Test
    public fun bestStreak_findsLongestRunAcrossGaps() {
        val active =
            setOf(
                "2026-05-01",
                "2026-05-02",
                "2026-05-04",
                "2026-05-05",
                "2026-05-06",
                "2026-05-07",
                "2026-05-09",
            )
        // Longest run is 5/4..5/7 = 4
        assertEquals(4, DateLogic.bestStreak(active))
    }
}
