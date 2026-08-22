package com.pomo.sync.timer

import java.util.UUID

/**
 * Kernel-backed live timer. Phase truth is the materializer projection; the
 * wall clock only derives remaining time for the accepted head.
 */
internal class ActivePhaseTimer(
    private val deviceId: String,
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
) {
    private val facts = mutableListOf<TimerFact>()
    private var phaseAnchorMillis: Long = 0
    private var running: Boolean = false
    private var ownershipClaimId: String = ""

    val projection: ActivePhaseProjection
        get() = ActivePhaseMaterializer.materialize(facts)

    fun remainingMillis(): Long {
        val current = projection
        val plan = current.plan ?: return 0
        val head =
            facts
                .filter { it.operationId in current.heads }
                .maxByOrNull { it.operationId }
                ?: return plan.durationMillis
        val baseElapsed = head.elapsedMillis
        val live =
            if (running && head.action in setOf(TimerAction.START, TimerAction.RESUME)) {
                (nowMillis() - phaseAnchorMillis).coerceAtLeast(0)
            } else {
                0
            }
        return (plan.durationMillis - baseElapsed - live).coerceAtLeast(0)
    }

    fun start(
        plan: PhasePlan,
        phaseId: String = UUID.randomUUID().toString(),
    ): ActivePhaseProjection {
        facts.clear()
        running = true
        phaseAnchorMillis = nowMillis()
        ownershipClaimId = nextId()
        return append(
            TimerFact(
                operationId = nextId(),
                phaseId = phaseId,
                action = TimerAction.START,
                parentHeads = emptySet(),
                ownerDeviceId = deviceId,
                ownershipClaimId = ownershipClaimId,
                plan = plan,
                elapsedMillis = 0,
            ),
        )
    }

    fun pause(): ActivePhaseProjection {
        val current = requireActive()
        val elapsed = current.plan!!.durationMillis - remainingMillis()
        running = false
        return append(
            TimerFact(
                operationId = nextId(),
                phaseId = current.phaseId!!,
                action = TimerAction.PAUSE,
                parentHeads = current.heads,
                ownerDeviceId = deviceId,
                ownershipClaimId = ownershipClaimId,
                plan = current.plan,
                elapsedMillis = elapsed.coerceAtLeast(0),
            ),
        )
    }

    fun resume(): ActivePhaseProjection {
        val current = requireActive()
        running = true
        phaseAnchorMillis = nowMillis()
        return append(
            TimerFact(
                operationId = nextId(),
                phaseId = current.phaseId!!,
                action = TimerAction.RESUME,
                parentHeads = current.heads,
                ownerDeviceId = deviceId,
                ownershipClaimId = ownershipClaimId,
                plan = current.plan!!,
                elapsedMillis = current.plan.durationMillis - remainingMillis(),
            ),
        )
    }

    fun complete(): ActivePhaseProjection {
        val current = requireActive()
        running = false
        return append(
            TimerFact(
                operationId = nextId(),
                phaseId = current.phaseId!!,
                action = TimerAction.COMPLETE,
                parentHeads = current.heads,
                ownerDeviceId = deviceId,
                ownershipClaimId = ownershipClaimId,
                plan = current.plan!!,
                elapsedMillis = current.plan.durationMillis,
            ),
        )
    }

    private fun append(fact: TimerFact): ActivePhaseProjection {
        facts += fact
        return ActivePhaseMaterializer.materialize(facts)
    }

    private fun requireActive(): ActivePhaseProjection {
        val current = projection
        require(current.phaseId != null && current.plan != null) { "no active phase" }
        return current
    }

    private fun nextId(): String = UUID.randomUUID().toString().replace("-", "")
}
