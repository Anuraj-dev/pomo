package com.pomo.sync.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

public class SharedDataMaterializerTest {
    @Test
    public fun sharedFieldsConvergeWithoutSynchronizingDeviceLocalPresentation() {
        val patches =
            listOf(
                SharedPreferencePatch("focusMinutes", "25", "a", "active-phase"),
                SharedPreferencePatch("focusMinutes", "30", "b", "active-phase"),
                SharedPreferencePatch("theme", "dark", "c", null),
            )
        val projection = SharedPreferencesMaterializer.materialize(patches)
        assertEquals("30", projection.getValue("focusMinutes").value)
        assertEquals(
            "30",
            SharedPreferencesMaterializer.materialize(patches.reversed()).getValue("focusMinutes").value,
        )
        assertEquals("active-phase", projection.getValue("focusMinutes").effectiveAfterPhaseId)
        assertFalse("theme" in projection)
        assertTrue(SharedPreferencesMaterializer.isDeviceLocal("routeHealth"))
    }

    @Test
    public fun missingProfileBlobRetainsLastCompleteProfile() {
        val current = ProfileVersion("a", "Snehit", "photo-old")
        val incoming = ProfileVersion("b", "Snehit Rai", "photo-new")
        val pending = ProfileMaterializer.apply(ProfileProjection(current, null), incoming, setOf("photo-old"))
        assertEquals(current, pending.complete)
        assertEquals(incoming, pending.pending)
        val complete = ProfileMaterializer.apply(pending, incoming, setOf("photo-old", "photo-new"))
        assertEquals(incoming, complete.complete)
        assertNull(complete.pending)
    }

    @Test
    public fun concurrentCrewJoinLeavePausesPublicationAndUnknownFamiliesForward() {
        val projection =
            CrewMembershipMaterializer.materialize(
                listOf(CrewMembershipFact("a", "crew", MembershipIntent.JOIN), CrewMembershipFact("b", "crew", MembershipIntent.LEAVE)),
            )
        assertTrue(projection.decisionRequired)
        assertTrue(projection.publicationPaused)
        assertEquals(DataFamilyDisposition.PENDING_FORWARD, classifyDataFamily(2))
        assertEquals(64, CrewMembershipMaterializer.pseudonym(ByteArray(32) { 7 }, "crew").length)
    }
}
