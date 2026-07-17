package com.pomo.db

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
public class CrewDaoTest {
    private lateinit var db: AppDatabase
    private lateinit var dao: CrewDao

    @Before
    public fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        db =
            Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
                .allowMainThreadQueries()
                .build()
        dao = db.crewDao()
    }

    @After
    public fun tearDown() {
        db.close()
    }

    @Test
    public fun upsertLatestRejectsOlderSnapshotAndReplacesAggregatesAtomically(): Unit =
        runTest {
            val first = snapshot(publishedAt = 100, allTimeMinutes = 50)
            val newer = snapshot(publishedAt = 200, allTimeMinutes = 75)
            val older = snapshot(publishedAt = 150, allTimeMinutes = 999)

            assertTrue(dao.upsertLatest(first, aggregates(first, 50)))
            assertTrue(dao.upsertLatest(newer, aggregates(newer, 75)))
            assertFalse(dao.upsertLatest(older, aggregates(older, 999)))

            assertEquals(75, dao.getSnapshots(CREW_ID).single().allTimeFocusMinutes)
            assertEquals(75, dao.getDailyAggregates(CREW_ID).single().focusMinutes)
        }

    @Test
    public fun crewRowsAreIsolatedAndCascadeDailyAggregatesOnDelete(): Unit =
        runTest {
            val first = snapshot(crewId = CREW_ID, publishedAt = 100, allTimeMinutes = 50)
            val second = snapshot(crewId = OTHER_CREW_ID, publishedAt = 100, allTimeMinutes = 60)
            dao.upsertLatest(first, aggregates(first, 50))
            dao.upsertLatest(second, aggregates(second, 60))

            dao.deleteCrewProjection(CREW_ID)

            assertTrue(dao.getSnapshots(CREW_ID).isEmpty())
            assertTrue(dao.getDailyAggregates(CREW_ID).isEmpty())
            assertEquals(1, dao.getSnapshots(OTHER_CREW_ID).size)
        }

    @Test
    public fun hiddenMembersAndRelayStatesAreReactive(): Unit =
        runTest {
            dao.upsertHiddenMember(CrewHiddenMemberEntity(CREW_ID, IDENTITY, 100))
            dao.upsertRelayState(CrewRelayStateEntity(CREW_ID, "wss://relay.example", 100, 100, null))

            assertEquals(IDENTITY, dao.observeHiddenMembers(CREW_ID).first().single().identityPublicKey)
            assertEquals("wss://relay.example", dao.observeRelayStates(CREW_ID).first().single().relayUrl)
        }

    private fun snapshot(
        crewId: String = CREW_ID,
        publishedAt: Long,
        allTimeMinutes: Int,
    ): CrewSnapshotEntity =
        CrewSnapshotEntity(
            crewId = crewId,
            identityPublicKey = IDENTITY,
            displayName = "Asha",
            allTimeFocusMinutes = allTimeMinutes,
            publishedAtEpochSeconds = publishedAt,
            localDate = "2026-06-20",
            utcOffsetMinutes = 330,
            currentStreak = 2,
            lastFocusedAtEpochSeconds = publishedAt,
            protocolVersion = 2,
        )

    private fun aggregates(
        snapshot: CrewSnapshotEntity,
        minutes: Int,
    ): List<CrewDailyAggregateEntity> =
        listOf(
            CrewDailyAggregateEntity(
                crewId = snapshot.crewId,
                identityPublicKey = snapshot.identityPublicKey,
                localDate = snapshot.localDate,
                focusMinutes = minutes,
                completedWorkBlocks = 2,
            ),
        )

    private companion object {
        private val CREW_ID: String = "11".repeat(16)
        private val OTHER_CREW_ID: String = "22".repeat(16)
        private val IDENTITY: String = "33".repeat(32)
    }
}
