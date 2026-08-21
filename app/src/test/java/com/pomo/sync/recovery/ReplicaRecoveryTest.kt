package com.pomo.sync.recovery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class ReplicaRecoveryTest {
    @Test
    public fun unionsVerifiedSourcesWithProvenanceAndListsExactGaps() {
        val checkpoint = CheckpointManifest(
            "cp",
            "RECOVERY",
            listOf(FrontierHead("a", 1, "a1")),
            1,
            "root",
            listOf("pack"),
            emptyList(),
        )
        val a1 = PackedOperation("a1", "a", 1, byteArrayOf(1))
        val a3 = PackedOperation("a3", "a", 3, byteArrayOf(3))
        val plan = Rehydrator.plan(
            listOf(
                RecoverySource("device", checkpoint, listOf(a1)),
                RecoverySource("mailbox", checkpoint, listOf(a1, a3)),
            ),
        )
        assertEquals(setOf("device", "mailbox"), plan.sourceByOperation.getValue("a1"))
        assertEquals(setOf("a@2"), plan.gaps)
        assertEquals(listOf("a1", "a3"), plan.operations.map { it.operationId })
    }

    @Test
    public fun packsOnlyReplaceCompleteForkFreePrefixesAndNamedAnchorsRemainInspectable() {
        val pack = JournalPack(
            "pack",
            FrontierHead("a", 2, "a2"),
            listOf(
                PackedOperation("a1", "a", 1, byteArrayOf(1)),
                PackedOperation("a2", "a", 2, byteArrayOf(2)),
            ),
        )
        CheckpointPolicy.validatePack(pack, emptySet())
        assertTrue(runCatching { CheckpointPolicy.validatePack(pack, setOf("a")) }.isFailure)
        assertTrue(
            runCatching {
                CheckpointPolicy.validate(CheckpointManifest("cp", "SAFETY", emptyList(), 1, "root", emptyList(), emptyList()))
            }.isSuccess,
        )
    }

    @Test
    public fun projectionCorruptionRebuildsButJournalOrKeyCorruptionSealsReplica() {
        assertFalse(integrityDisposition(IntegrityFailure.PROJECTION_CORRUPT).active)
        assertTrue(integrityDisposition(IntegrityFailure.JOURNAL_CORRUPT).incarnationSealed)
        assertTrue(integrityDisposition(IntegrityFailure.DEVICE_KEY_MISSING).inspectionAllowed)
    }
}
