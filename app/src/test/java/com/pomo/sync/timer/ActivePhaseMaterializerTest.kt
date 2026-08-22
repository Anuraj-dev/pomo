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

    @Test
    public fun staleOwnerCommandAfterHandoffLeavesTheJournalWithoutThrowing() {
        val start = fact("start", TimerAction.START, emptySet(), "android", "claim-a")
        val handoff = fact("handoff", TimerAction.HANDOFF, setOf("start"), "chrome", "claim-b")
        val stale = fact("stale-extend", TimerAction.EXTEND, setOf("handoff"), "android", "claim-a")
        val projection = ActivePhaseMaterializer.materialize(listOf(start, handoff, stale))
        assertEquals(setOf("stale-extend"), projection.staleCommandIds)
        assertEquals(setOf("handoff"), projection.heads)
        assertEquals("chrome", projection.ownerDeviceId)
        assertFalse(projection.settlementRequired)
    }

    @Test
    public fun settlementMustCiteEveryConflictHead() {
        val start = fact("start", TimerAction.START, emptySet(), "android", "claim-a")
        val pause = fact("pause", TimerAction.PAUSE, setOf("start"), "android", "claim-a")
        val takeover = fact("takeover", TimerAction.PROVISIONAL_TAKEOVER, setOf("start"), "chrome", "claim-b")
        val incomplete = fact("partial", TimerAction.SETTLE, setOf("pause"), "chrome", "claim-b")
        val incompleteProjection = ActivePhaseMaterializer.materialize(listOf(start, pause, takeover, incomplete))
        assertEquals(setOf("pause", "takeover"), incompleteProjection.heads)
        assertTrue(incompleteProjection.settlementRequired)
        val complete = fact("settle", TimerAction.SETTLE, setOf("pause", "takeover"), "chrome", "claim-b")
        val settled = ActivePhaseMaterializer.materialize(listOf(start, pause, takeover, complete))
        assertEquals(setOf("settle"), settled.heads)
        assertFalse(settled.settlementRequired)
        assertEquals("chrome", settled.ownerDeviceId)
    }

    @Test
    public fun descendantsOfPendingParentsRemainPending() {
        val start = fact("start", TimerAction.START, emptySet(), "android", "claim-a")
        val orphanParent = fact("orphan-parent", TimerAction.HANDOFF, setOf("missing"), "chrome", "claim-b")
        val descendant = fact("descendant", TimerAction.SETTLE, setOf("start", "orphan-parent"), "chrome", "claim-b")
        val projection = ActivePhaseMaterializer.materialize(listOf(start, orphanParent, descendant))
        assertEquals(setOf("orphan-parent", "descendant"), projection.pending)
        assertEquals(setOf("start"), projection.heads)
        assertFalse(projection.settlementRequired)
    }

    private fun fact(
        id: String,
        action: TimerAction,
        parents: Set<String>,
        owner: String,
        claim: String,
    ): TimerFact = TimerFact(id, "phase-1", action, parents, owner, claim, plan, 0)
}
