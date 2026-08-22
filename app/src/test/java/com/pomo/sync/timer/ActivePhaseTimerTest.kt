package com.pomo.sync.timer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

public class ActivePhaseTimerTest {
    @Test
    public fun startPauseResumeDeriveRemainingFromProjection() {
        var now = 1_000L
        val timer = ActivePhaseTimer("device-a") { now }
        val plan = PhasePlan(PhaseKind.WORK, 60_000, null)
        timer.start(plan, "phase-1")
        assertEquals(60_000, timer.remainingMillis())
        now = 1_000 + 10_000
        assertEquals(50_000, timer.remainingMillis())
        timer.pause()
        now = 1_000 + 30_000
        assertEquals(50_000, timer.remainingMillis())
        timer.resume()
        now = 1_000 + 35_000
        assertEquals(45_000, timer.remainingMillis())
        val completed = timer.complete()
        assertTrue(completed.completedOperationIds.isNotEmpty())
        assertEquals(0, timer.remainingMillis())
    }
}
