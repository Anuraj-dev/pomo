package com.pomo.db

import androidx.test.core.app.ApplicationProvider
import com.pomo.models.Session
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Calendar

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
public class HistoryCacheRepositoryTest {
    private lateinit var repo: HistoryCacheRepository

    @Before
    public fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        repo = HistoryCacheRepository(ctx)
        // Reset singleton DB state between tests
        runTest { repo.clearCache() }
    }

    @After
    public fun tearDown() {
        runTest { repo.clearCache() }
    }

    @Test
    public fun saveLocalSession_workCompleted_incrementsCompletedAndMinutes(): Unit =
        runTest {
            val session = Session(type = "work", start = currentDayNoonEpochSecond(), duration = 1500, completed = true)
            repo.saveLocalSession(session)

            val count = repo.getTodayCompletedCount()
            assertEquals(1, count)

            val date = repo.getEffectiveDateString()
            val stats = repo.getCachedDayStats().firstOrNull { it.date == date }
            assertNotNull(stats)
            assertEquals(1, stats!!.completed)
            assertEquals(25, stats.workMinutes)
            assertEquals(0, stats.breakMinutes)
        }

    @Test
    public fun saveLocalSession_workIncomplete_creditsMinutesButNotBlock(): Unit =
        runTest {
            val session = Session(type = "work", start = currentDayNoonEpochSecond(), duration = 1500, completed = false)
            repo.saveLocalSession(session)

            // Partial (skipped) block: minutes are time-honest, the block is not earned (ADR-0002).
            assertEquals(0, repo.getTodayCompletedCount())
            val date = repo.getEffectiveDateString()
            val stats = repo.getCachedDayStats().firstOrNull { it.date == date }
            assertNotNull(stats)
            assertEquals(25, stats!!.workMinutes)
        }

    @Test
    public fun saveLocalSession_break_addsBreakMinutesOnly(): Unit =
        runTest {
            val short = Session(type = "short", start = currentDayNoonEpochSecond(), duration = 300, completed = true)
            repo.saveLocalSession(short)
            val long = Session(type = "long", start = currentDayNoonEpochSecond() + 1, duration = 900, completed = true)
            repo.saveLocalSession(long)

            val date = repo.getEffectiveDateString()
            val stats = repo.getCachedDayStats().firstOrNull { it.date == date }
            assertNotNull(stats)
            assertEquals(0, stats!!.completed)
            assertEquals(0, stats.workMinutes)
            assertEquals(20, stats.breakMinutes) // 5 + 15
        }

    @Test
    public fun saveLocalSession_multipleWork_accumulates(): Unit =
        runTest {
            repeat(3) { i ->
                repo.saveLocalSession(
                    Session(type = "work", start = currentDayNoonEpochSecond() + i, duration = 1500, completed = true),
                )
            }
            assertEquals(3, repo.getTodayCompletedCount())
            val date = repo.getEffectiveDateString()
            val stats = repo.getCachedDayStats().first { it.date == date }
            assertEquals(75, stats.workMinutes)
        }

    @Test
    public fun saveLocalSession_splitsMinutesAcrossCalendarDays(): Unit =
        runTest {
            val start = localEpochSecond(year = 2026, month = Calendar.MAY, day = 7, hour = 23, minute = 50, second = 0)
            repo.saveLocalSession(
                Session(type = "work", start = start, duration = 20 * 60, completed = true),
            )

            val stats = repo.getCachedDayStats().associateBy { it.date }

            assertEquals(10, stats["2026-05-07"]?.workMinutes)
            assertEquals(10, stats["2026-05-08"]?.workMinutes)
            // The block is filed under the day it started; the new day carries minutes only (ADR-0002).
            assertEquals(1, stats["2026-05-07"]?.completed)
            assertEquals(0, stats["2026-05-08"]?.completed)
        }

    @Test
    public fun getHistoryPayload_includesSessions(): Unit =
        runTest {
            repo.saveLocalSession(
                Session(type = "work", start = currentDayNoonEpochSecond(), duration = 1500, completed = true),
            )
            val payload = repo.getHistoryPayload()
            val date = repo.getEffectiveDateString()
            val entry = payload[date]
            assertNotNull(entry)
            assertEquals(1, entry!!.completed)
            assertEquals(25, entry.work_minutes)
            assertEquals(1, entry.sessions.size)
            assertEquals("work", entry.sessions[0].type)
        }

    private fun localEpochSecond(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        second: Int,
    ): Long {
        return Calendar.getInstance().apply {
            set(Calendar.YEAR, year)
            set(Calendar.MONTH, month)
            set(Calendar.DAY_OF_MONTH, day)
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, second)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis / 1000L
    }

    private fun currentDayNoonEpochSecond(): Long {
        return Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, 12)
            set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }.timeInMillis / 1000L
    }
}
