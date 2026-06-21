package com.pomo.crew

import android.content.Context
import androidx.test.core.app.ApplicationProvider
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
public class CrewStoreTest {
    private lateinit var context: Context

    @Before
    public fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    public fun initArchivesLegacyMembershipsOnceAndExposesReadOnlyArchivedMemberships() {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(
                LEGACY_MEMBERSHIPS_KEY,
                """
                [
                  {"crewId":"${"11".repeat(16)}","displayName":"Asha"},
                  {"crewId":"${"22".repeat(16)}","displayName":""}
                ]
                """.trimIndent(),
            )
            .commit()

        val store = CrewStore(context)
        val archived = store.loadArchivedMemberships()

        assertEquals(2, archived.size)
        assertTrue(archived.all { it.isArchived })
        assertTrue(archived.all { it.protocolVersion == 1 })
        assertEquals("Asha", archived.first().displayName)
        assertEquals("Me", archived.last().displayName)
        assertFalse(
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .contains(LEGACY_MEMBERSHIPS_KEY),
        )
    }

    @Test
    public fun replaceMembershipsKeepsOnlyDistinctActiveV2Memberships() {
        val store = CrewStore(context)
        val first = membership(crewId = "11".repeat(16), crewName = "Alpha")
        val duplicate = membership(crewId = first.crewId, crewName = "Alpha Copy")
        val second = membership(crewId = "22".repeat(16), crewName = "Beta")

        store.replaceMemberships(listOf(second, first, duplicate))

        val memberships = store.loadMemberships()
        assertEquals(listOf("Alpha", "Beta"), memberships.map { it.crewName })
        assertEquals(first.crewId, store.loadMembership()?.crewId)
    }

    private fun membership(crewId: String, crewName: String): CrewMembership {
        val payload = CrewJoinPayload(
            crewId = crewId,
            crewName = crewName,
            relays = listOf("wss://relay.example"),
            key = "33".repeat(32),
        )
        return CrewMembership(
            crewId = crewId,
            crewName = crewName,
            joinCode = CrewJoinCodeCodec.encode(payload),
            relays = payload.relays,
            key = payload.key,
            displayName = "Me",
        )
    }

    private companion object {
        private const val PREFS_NAME: String = "crew_prefs"
        private const val LEGACY_MEMBERSHIPS_KEY: String = "memberships"
    }
}
