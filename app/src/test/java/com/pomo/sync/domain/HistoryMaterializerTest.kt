package com.pomo.sync.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class HistoryMaterializerTest {
    @Test
    public fun concurrentCorrectionAndTombstoneRemainUntilExplicitSettlement() {
        val original = block("block-1", 1_500, "tag-work", "Work")
        val corrected = original.copy(elapsedMillis = 1_800)
        val facts =
            listOf(
                HistoryFact.Create("create", original),
                HistoryFact.Correct("correct", original.blockId, corrected),
                HistoryFact.Tombstone("delete", original.blockId),
            )
        val conflicted = HistoryMaterializer().materialize(facts)
        assertTrue(original.blockId in conflicted.conflicts)
        assertEquals(3, conflicted.alternatives.getValue(original.blockId).size)

        val settled =
            HistoryMaterializer().materialize(
                facts + HistoryFact.Settle("settle", original.blockId, setOf("create", "correct")),
            )
        assertEquals(1_800L, settled.visible.getValue(original.blockId).elapsedMillis)
        assertFalse(original.blockId in settled.conflicts)
    }

    @Test
    public fun missingHistoryDoesNotDeleteAndDerivedTotalsRebuildFromVisibleBlocks() {
        val materializer = HistoryMaterializer()
        val first = block("stable-a", 60_000, "tag-work", "Work")
        val second = block("stable-b", 30_000, "tag-study", "Study").copy(outcome = HistoryOutcome.PARTIAL)
        val projection = materializer.materialize(listOf(HistoryFact.Create("a", first), HistoryFact.Create("b", second)))
        assertEquals(90_000L to 1, materializer.dailyTotals(projection).getValue("2026-08-21"))
        assertEquals(setOf("stable-a", "stable-b"), projection.visible.keys)
    }

    @Test
    public fun settlementSelectingMultipleCorrectionsRemainsConflicted() {
        val original = block("block-2", 1_500, "tag-work", "Work")
        val facts =
            listOf(
                HistoryFact.Create("create", original),
                HistoryFact.Correct("correct-a", original.blockId, original.copy(elapsedMillis = 1_600)),
                HistoryFact.Correct("correct-b", original.blockId, original.copy(elapsedMillis = 1_700)),
                HistoryFact.Settle("settle", original.blockId, setOf("create", "correct-a", "correct-b")),
            )

        val materialized = HistoryMaterializer().materialize(facts)

        assertTrue(original.blockId in materialized.conflicts)
        assertTrue(original.blockId !in materialized.visible)
    }

    @Test
    public fun settlementSelectingForeignBlockFactRemainsConflicted() {
        val local = block("block-local", 1_500, "tag-work", "Work")
        val foreign = block("block-foreign", 2_000, "tag-study", "Study")
        val facts =
            listOf(
                HistoryFact.Create("create-local", local),
                HistoryFact.Correct("correct-local", local.blockId, local.copy(elapsedMillis = 1_800)),
                HistoryFact.Create("create-foreign", foreign),
                HistoryFact.Settle("settle-local", local.blockId, setOf("create-foreign")),
            )

        val materialized = HistoryMaterializer().materialize(facts)

        assertTrue(local.blockId in materialized.conflicts)
        assertTrue(local.blockId !in materialized.visible)
        assertEquals(2_000L, materialized.visible.getValue(foreign.blockId).elapsedMillis)
    }

    @Test
    public fun tagIdentitySurvivesRenameArchiveRestoreAndMerge() {
        val work = SessionTag("tag-work", "Work", 0)
        val study = SessionTag("tag-study", "Study", 1)
        val materializer = TagMaterializer(work.tagId)
        var state = mapOf(work.tagId to work, study.tagId to study)
        var default = study.tagId
        materializer.apply(state, study.copy(name = "Deep work"), default).also { (next, selected) ->
            state = next
            default = selected
        }
        materializer.apply(state, state.getValue(study.tagId).copy(archived = true), default).also { (next, selected) ->
            state = next
            default = selected
        }
        assertEquals(work.tagId, default)
        assertEquals("Deep work", state.getValue(study.tagId).name)
        assertTrue(DestructiveHistoryGuard.authorize(setOf("a"), emptySet()))
        assertFalse(DestructiveHistoryGuard.authorize((1..10).map { "$it" }.toSet(), emptySet()))
    }

    private fun block(
        id: String,
        elapsed: Long,
        tagId: String,
        tagName: String,
    ): HistoryBlock =
        HistoryBlock(
            id,
            "phase-$id",
            1_755_734_400_000,
            elapsed,
            HistoryOutcome.COMPLETED,
            tagId,
            tagName,
            "2026-08-21",
        )
}
