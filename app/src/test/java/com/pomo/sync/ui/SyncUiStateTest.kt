package com.pomo.sync.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class SyncUiStateTest {
    @Test
    public fun retryPreservesSafetyStateAndOnlySchedulesDrain() {
        val safe = SyncUiState.Dormant.copy(health = SyncHealth.SAFE_MODE, affectedTimerDomain = true)
        assertEquals(safe.copy(retryPending = true), scheduleOrdinaryDrain(safe))
        assertFalse(timerControlsAllowed(safe))
    }
    @Test
    public fun unrelatedConflictAndDormantSyncKeepTimerUsable() {
        assertTrue(timerControlsAllowed(SyncUiState.Dormant))
        assertTrue(timerControlsAllowed(SyncUiState.Dormant.copy(health = SyncHealth.CONFLICT, affectedTimerDomain = false)))
    }
}
