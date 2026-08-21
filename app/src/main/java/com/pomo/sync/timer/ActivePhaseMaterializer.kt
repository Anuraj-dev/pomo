package com.pomo.sync.timer

internal enum class PhaseKind { WORK, SHORT_BREAK, LONG_BREAK }
internal enum class TimerAction { START, PAUSE, RESUME, EXTEND, SKIP, RESET, COMPLETE, HANDOFF, PROVISIONAL_TAKEOVER, SETTLE }

internal data class PhasePlan(val kind: PhaseKind, val durationMillis: Long, val tagId: String?)
internal data class TimerFact(
    val operationId: String,
    val phaseId: String,
    val action: TimerAction,
    val parentHeads: Set<String>,
    val ownerDeviceId: String,
    val ownershipClaimId: String,
    val plan: PhasePlan,
    val elapsedMillis: Long,
    val timeUncertain: Boolean = false,
    val composedElapsedMillis: Long? = null,
)

internal data class ActivePhaseProjection(
    val phaseId: String?,
    val plan: PhasePlan?,
    val heads: Set<String>,
    val ownerDeviceId: String?,
    val settlementRequired: Boolean,
    val completedOperationIds: Set<String>,
    val timeUncertain: Boolean,
    val pending: Set<String>,
)

internal data class TimerCommandRequest(
    val requesterDeviceId: String,
    val phaseId: String,
    val exactCommandHead: String,
    val action: TimerAction,
)

internal object ActivePhaseMaterializer {
    fun materialize(input: Collection<TimerFact>): ActivePhaseProjection {
        val facts = input.distinctBy { it.operationId }.sortedBy { it.operationId }
        if (facts.isEmpty()) return ActivePhaseProjection(null, null, emptySet(), null, false, emptySet(), false, emptySet())
        require(facts.map { it.phaseId }.distinct().size == 1) { "Projection must target one identified phase" }
        val byId = facts.associateBy { it.operationId }
        val accepted = linkedMapOf<String, TimerFact>()
        val pending = linkedSetOf<String>()
        facts.forEach { fact ->
            if (!byId.keys.containsAll(fact.parentHeads)) pending += fact.operationId else accepted[fact.operationId] = fact
        }
        val starts = accepted.values.filter { it.action == TimerAction.START }
        require(starts.isNotEmpty())
        val plan = starts.first().plan
        accepted.values.forEach { fact ->
            require(fact.plan == plan) { "Handoff and commands cannot rewrite the locked Phase plan" }
            require(fact.elapsedMillis >= 0)
            if (fact.action == TimerAction.SETTLE) require(fact.parentHeads.size >= 2)
            if (fact.action in normalOwnerActions) {
                val parent = fact.parentHeads.singleOrNull()?.let(accepted::get)
                    ?: error("Normal Timer command requires one exact command head")
                require(fact.ownerDeviceId == parent.ownerDeviceId && fact.ownershipClaimId == parent.ownershipClaimId) {
                    "Only the uncontested owner may author a normal Timer command"
                }
            }
        }
        val referenced = accepted.values.flatMapTo(linkedSetOf()) { it.parentHeads }
        val heads = accepted.keys.filterTo(linkedSetOf()) { it !in referenced }
        val headFacts = heads.mapNotNull(byId::get)
        val settlementRequired = heads.size > 1 || headFacts.count { it.action == TimerAction.SETTLE } > 1
        val settled = headFacts.singleOrNull()?.takeIf { it.action == TimerAction.SETTLE }
        val effectiveHead = settled ?: headFacts.singleOrNull()
        val completions = accepted.values.filter { it.action == TimerAction.COMPLETE }.mapTo(linkedSetOf()) { it.operationId }
        return ActivePhaseProjection(
            phaseId = facts.first().phaseId,
            plan = plan,
            heads = heads,
            ownerDeviceId = effectiveHead?.ownerDeviceId,
            settlementRequired = settlementRequired,
            completedOperationIds = completions,
            timeUncertain = accepted.values.any { it.timeUncertain },
            pending = pending,
        )
    }

    private val normalOwnerActions =
        setOf(TimerAction.PAUSE, TimerAction.RESUME, TimerAction.EXTEND, TimerAction.SKIP, TimerAction.RESET, TimerAction.COMPLETE)
}
