package com.pomo.crew

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.pomo.db.AppDatabase
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
public class CrewRepositoryTest {
    private lateinit var context: Context

    @Before
    public fun setUp(): Unit = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        clearPrefs()
        AppDatabase.getInstance(context).crewDao().deleteCrewProjection(CREW_ID)
    }

    @Test
    public fun currentBoardUsesDateWindowForHiddenMemberFocusTotals(): Unit = runBlocking {
        val store = CrewStore(context)
        val projectionStore = CrewProjectionStore(context)
        store.saveMembership(
            CrewMembership(
                crewId = CREW_ID,
                crewName = "Deep Work",
                joinCode = CrewJoinCodeCodec.encode(
                    CrewJoinPayload(
                        crewId = CREW_ID,
                        crewName = "Deep Work",
                        relays = listOf(RELAY_URL),
                        key = CREW_KEY,
                    ),
                ),
                relays = listOf(RELAY_URL),
                key = CREW_KEY,
                displayName = "Owner",
            ),
        )
        projectionStore.upsertLatest(snapshot(identity = identity(1), name = "Visible", dailyMinutes = mapOf(0 to 30)))
        projectionStore.upsertLatest(
            snapshot(
                identity = identity(2),
                name = "Hidden",
                dailyMinutes = mapOf(0 to 90, 7 to 200),
            ),
        )
        projectionStore.setHidden(CREW_ID, identity(2), hidden = true)

        val board = CrewRepository(context).currentBoard(CrewRankingMode.SevenDays)

        assertEquals(1, board?.hiddenMembers?.size)
        assertEquals(90, board?.hiddenMembers?.single()?.selectedFocusMinutes)
    }

    private fun snapshot(
        identity: String,
        name: String,
        dailyMinutes: Map<Int, Int>,
    ): CrewSnapshot {
        val today = LocalDate.of(2026, 6, 21)
        return CrewSnapshot(
            crewId = CREW_ID,
            identityPublicKey = identity,
            displayName = name,
            allTimeFocusMinutes = dailyMinutes.values.sum(),
            publishedAtEpochSeconds = 1_718_927_200L,
            localDate = today.toString(),
            utcOffsetMinutes = 0,
            dailyAggregates = dailyMinutes.entries
                .map { (daysAgo, minutes) ->
                    CrewDailyAggregate(
                        localDate = today.minusDays(daysAgo.toLong()).toString(),
                        focusMinutes = minutes,
                        completedWorkBlocks = minutes / 25,
                    )
                }
                .sortedByDescending { it.localDate },
            currentStreak = 1,
            lastFocusedAtEpochSeconds = 1_718_927_200L,
        )
    }

    private fun identity(index: Int): String = index.toString(16).padStart(64, '0')

    private fun clearPrefs() {
        context.getSharedPreferences("crew_prefs", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("crew_secure", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences("pairing_prefs", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private companion object {
        private val CREW_ID: String = "cd".repeat(16)
        private val CREW_KEY: String = "ef".repeat(32)
        private const val RELAY_URL: String = "wss://relay.example"
    }
}
