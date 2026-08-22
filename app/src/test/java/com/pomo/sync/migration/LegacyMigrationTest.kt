package com.pomo.sync.migration

import org.junit.Assert.assertTrue
import org.junit.Test

public class LegacyMigrationTest {
    private val ready =
        MigrationPrerequisites(
            "anchor",
            true,
            LegacyTimerState.PARKED,
            true,
            MigrationVerification(2, 2, true, true),
        )

    @Test
    public fun inventoryRequiresDispositionForEveryDurableItem() {
        val kinds =
            LegacyDisposition.entries.mapIndexed { index, kind ->
                LegacyInventoryItem("android", "id-$index", "history", kind, "classified")
            }
        MigrationInventory("android", kinds, kinds.size)
        assertTrue(runCatching { MigrationInventory("android", kinds, kinds.size + 1) }.isFailure)
    }

    @Test
    public fun identityBaselineTimerAndOmissionsBlockCutover() {
        assertTrue(
            runCatching {
                requireIdentitySelection(
                    listOf(MigrationIdentity("a", setOf("crew-a")), MigrationIdentity("b", setOf("crew-b"))),
                    null,
                )
            }.isFailure,
        )
        assertTrue(runCatching { verifyMigrationReady(ready.copy(timerState = LegacyTimerState.PAUSED)) }.isFailure)
        assertTrue(runCatching { verifyMigrationReady(ready.copy(baselineCaughtUp = false)) }.isFailure)
        assertTrue(runCatching { verifyMigrationReady(ready.copy(verification = ready.verification.copy(explainedItems = 1))) }.isFailure)
    }

    @Test
    public fun atomicSuccessSealsArchiveAndPermanentlyRetiresDualWrite() {
        val activation = activateMigrationAtomically(ready, "journal", "encrypted-legacy")
        assertTrue(activation.dualWriteRetired)
        assertTrue(POMO_BACKUP_V1_WARNING.contains("sensitive"))
    }
}
