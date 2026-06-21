package com.pomo.crew

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.pomo.db.AppDatabase
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
public class CrewProjectionStoreTest {
    private lateinit var context: Context
    private lateinit var store: CrewProjectionStore

    @Before
    public fun setUp(): Unit = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        store = CrewProjectionStore(context)
        AppDatabase.getInstance(context).crewDao().deleteCrewProjection(CREW_ID)
    }

    @Test
    public fun recordRelayResultPreservesLastSuccessAcrossFailures(): Unit = runBlocking {
        store.recordRelayResult(CREW_ID, RELAY_URL, error = null)
        val first = AppDatabase.getInstance(context).crewDao().getRelayState(CREW_ID, RELAY_URL)

        store.recordRelayResult(CREW_ID, RELAY_URL, error = "timeout")
        val second = AppDatabase.getInstance(context).crewDao().getRelayState(CREW_ID, RELAY_URL)

        assertNotNull(first)
        assertNotNull(second)
        assertEquals(first?.lastSuccessEpochSeconds, second?.lastSuccessEpochSeconds)
        assertEquals("timeout", second?.lastError)
    }

    @Test
    public fun recordPublishResultTracksPublishFreshnessSeparatelyFromPulls(): Unit = runBlocking {
        store.recordRelayResult(CREW_ID, RELAY_URL, error = null)

        store.recordPublishResult(
            crewId = CREW_ID,
            result = CrewRelayPublishResult(
                relayUrl = RELAY_URL,
                accepted = true,
                error = null,
            ),
            nowEpochSeconds = 1234L,
        )

        assertEquals(1234L, store.lastPublishSuccessEpochSeconds(CREW_ID))
    }

    private companion object {
        private val CREW_ID: String = "ab".repeat(16)
        private const val RELAY_URL: String = "wss://relay.example"
    }
}
