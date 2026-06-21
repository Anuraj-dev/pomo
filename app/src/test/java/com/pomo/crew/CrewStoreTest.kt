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
    public fun initArchivesLegacyCurrentCrewFallbackWhenMembershipListIsMissing() {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(LEGACY_CURRENT_CREW_KEY, """{"crewId":"${"33".repeat(16)}","displayName":"Bo"}""")
            .commit()

        val store = CrewStore(context)
        val archived = store.loadArchivedMemberships()

        assertEquals(1, archived.size)
        assertEquals("Bo", archived.single().displayName)
        assertTrue(archived.single().isArchived)
    }

    private companion object {
        private const val PREFS_NAME: String = "crew_prefs"
        private const val LEGACY_CURRENT_CREW_KEY: String = "current_crew"
        private const val LEGACY_MEMBERSHIPS_KEY: String = "memberships"
    }
}
