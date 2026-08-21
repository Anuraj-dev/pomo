package com.pomo.sync.timer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class ActivePhaseMaterializerTest {
    private val plan = PhasePlan(PhaseKind.WORK, 1_500_000, "tag-work")

    @Test
    public fun concurrentAuthenticBranchesRequireSettlementAndRetainBothHeads() {
        val start = fact("start", TimerAction.START, emptySet(), "android", "claim-a")
        val pause = fact("pause", TimerAction.PAUSE, setOf("start"), "android", "claim-a")
        val takeover = fact("takeover", TimerAction.PROVISIONAL_TAKEOVER, setOf("start"), "chrome", "claim-b")
        val projection = ActivePhaseMaterializer.materialize(listOf(takeover, start, pause, start))
        assertEquals(setOf("pause", "takeover"), projection.heads)
        assertTrue(projection.settlementRequired)
    }

    @Test
    public fun handoffKeepsPlanAndCompletionIsIdempotentBeforeHistory() {
        val start = fact("start", TimerAction.START, emptySet(), "android", "claim-a")
        val handoff = fact("handoff", TimerAction.HANDOFF, setOf("start"), "chrome", "claim-b")
        val complete = fact("complete", TimerAction.COMPLETE, setOf("handoff"), "chrome", "claim-b")
        val projection = ActivePhaseMaterializer.materialize(listOf(start, handoff, complete, complete))
        assertEquals(setOf("complete"), projection.completedOperationIds)
        assertEquals("chrome", projection.ownerDeviceId)
        assertFalse(projection.settlementRequired)
    }

    @Test
    public fun runtimeLossMarksTimeUncertainWithoutChoosingAuthority() {
        val start = fact("start", TimerAction.START, emptySet(), "android", "claim-a")
        val uncertain = fact("uncertain", TimerAction.PAUSE, setOf("start"), "android", "claim-a").copy(timeUncertain = true)
        assertTrue(ActivePhaseMaterializer.materialize(listOf(start, uncertain)).timeUncertain)
    }

    private fun fact(id: String, action: TimerAction, parents: Set<String>, owner: String, claim: String): TimerFact =
        TimerFact(id, "phase-1", action, parents, owner, claim, plan, 0)
}
