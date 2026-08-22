package com.pomo.sync.timer

internal enum class PhaseKind {
    WORK,
    SHORT_BREAK,
    LONG_BREAK,
}

internal enum class TimerAction {
    START,
    PAUSE,
    RESUME,
    EXTEND,
    SKIP,
    RESET,
    COMPLETE,
    HANDOFF,
    PROVISIONAL_TAKEOVER,
    SETTLE,
}

internal data class PhasePlan(
    val kind: PhaseKind,
    val durationMillis: Long,
    val tagId: String?,
)

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
    val staleCommandIds: Set<String>,
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
        if (facts.isEmpty()) {
            return ActivePhaseProjection(
                null,
                null,
                emptySet(),
                null,
                false,
                emptySet(),
                false,
                emptySet(),
                emptySet(),
            )
        }
        require(facts.map { it.phaseId }.distinct().size == 1) { "Projection must target one identified phase" }
        val accepted = linkedMapOf<String, TimerFact>()
        val remaining = facts.toMutableList()
        var progressed = true
        while (progressed) {
            progressed = false
            val iterator = remaining.iterator()
            while (iterator.hasNext()) {
                val fact = iterator.next()
                if (fact.parentHeads.all { it in accepted }) {
                    accepted[fact.operationId] = fact
                    iterator.remove()
                    progressed = true
                }
            }
        }
        val pending = remaining.mapTo(linkedSetOf()) { it.operationId }
        val starts = accepted.values.filter { it.action == TimerAction.START }
        require(starts.isNotEmpty())
        val plan = starts.first().plan
        accepted.values.forEach { fact ->
            require(fact.plan == plan) { "Handoff and commands cannot rewrite the locked Phase plan" }
            require(fact.elapsedMillis >= 0)
        }
        val staleCommandIds = linkedSetOf<String>()
        accepted.values.filter { it.action in normalOwnerActions }.forEach { fact ->
            val parent = fact.parentHeads.singleOrNull()?.let(accepted::get)
            if (parent == null ||
                fact.ownerDeviceId != parent.ownerDeviceId ||
                fact.ownershipClaimId != parent.ownershipClaimId
            ) {
                staleCommandIds += fact.operationId
            }
        }
        staleCommandIds.forEach { accepted.remove(it) }
        var pruned = true
        while (pruned) {
            pruned = false
            val present = accepted.keys
            val orphaned = accepted.values.filter { fact -> fact.parentHeads.any { it !in present } }
            for (fact in orphaned) {
                accepted.remove(fact.operationId)
                staleCommandIds += fact.operationId
                pruned = true
            }
        }
        val withoutSettles = accepted.filterValues { it.action != TimerAction.SETTLE }
        val referencedWithoutSettles = withoutSettles.values.flatMapTo(linkedSetOf()) { it.parentHeads }
        val headsWithoutSettles =
            withoutSettles.keys.filterTo(linkedSetOf()) { it !in referencedWithoutSettles }
        val validSettles =
            accepted.values.filter { fact ->
                fact.action == TimerAction.SETTLE && fact.parentHeads == headsWithoutSettles && headsWithoutSettles.size >= 2
            }
        val canonical =
            if (validSettles.size == 1) {
                withoutSettles + (validSettles.single().operationId to validSettles.single())
            } else {
                accepted.filterKeys { id ->
                    accepted[id]?.action != TimerAction.SETTLE || validSettles.any { it.operationId == id }
                }
            }
        val referenced = canonical.values.flatMapTo(linkedSetOf()) { it.parentHeads }
        val heads = canonical.keys.filterTo(linkedSetOf()) { it !in referenced }
        val headFacts = heads.mapNotNull(canonical::get)
        val settlementRequired = heads.size > 1 || validSettles.size > 1
        val settled = headFacts.singleOrNull()?.takeIf { it.action == TimerAction.SETTLE }
        val effectiveHead = settled ?: headFacts.singleOrNull()
        val completions = canonical.values.filter { it.action == TimerAction.COMPLETE }.mapTo(linkedSetOf()) { it.operationId }
        return ActivePhaseProjection(
            phaseId = facts.first().phaseId,
            plan = plan,
            heads = heads,
            ownerDeviceId = effectiveHead?.ownerDeviceId,
            settlementRequired = settlementRequired,
            completedOperationIds = completions,
            timeUncertain = canonical.values.any { it.timeUncertain },
            pending = pending,
            staleCommandIds = staleCommandIds,
        )
    }

    private val normalOwnerActions =
        setOf(
            TimerAction.PAUSE,
            TimerAction.RESUME,
            TimerAction.EXTEND,
            TimerAction.SKIP,
            TimerAction.RESET,
            TimerAction.COMPLETE,
        )
}
