package com.pomo.sync.domain

internal enum class HistoryOutcome { COMPLETED, PARTIAL }

internal data class HistoryBlock(
    val blockId: String,
    val phaseId: String,
    val startedAtEpochMillis: Long,
    val elapsedMillis: Long,
    val outcome: HistoryOutcome,
    val tagId: String,
    val authoredTagName: String,
    val localDate: String,
)

internal sealed interface HistoryFact {
    val factId: String
    val blockId: String

    data class Create(override val factId: String, val block: HistoryBlock) : HistoryFact {
        override val blockId: String = block.blockId
    }

    data class Correct(
        override val factId: String,
        override val blockId: String,
        val replacement: HistoryBlock,
    ) : HistoryFact

    data class Tombstone(
        override val factId: String,
        override val blockId: String,
    ) : HistoryFact

    data class Settle(
        override val factId: String,
        override val blockId: String,
        val selectedFactIds: Set<String>,
    ) : HistoryFact
}

internal data class MaterializedHistory(
    val visible: Map<String, HistoryBlock>,
    val alternatives: Map<String, List<HistoryFact>>,
    val conflicts: Set<String>,
)

internal class HistoryMaterializer {
    fun materialize(facts: Collection<HistoryFact>): MaterializedHistory {
        val byId = facts.associateBy { it.factId }
        require(byId.size == facts.size) { "History fact IDs must be unique" }
        val alternatives = facts.groupBy { it.blockId }.toSortedMap()
        val visible = linkedMapOf<String, HistoryBlock>()
        val conflicts = linkedSetOf<String>()
        alternatives.forEach { (blockId, blockFacts) ->
            val creates = blockFacts.filterIsInstance<HistoryFact.Create>()
            val corrections = blockFacts.filterIsInstance<HistoryFact.Correct>()
            val tombstones = blockFacts.filterIsInstance<HistoryFact.Tombstone>()
            val settlements = blockFacts.filterIsInstance<HistoryFact.Settle>()
            if (creates.size != 1) {
                conflicts += blockId
                return@forEach
            }
            val settlement = settlements.singleOrNull()
            val blockFactIds = blockFacts.mapTo(linkedSetOf()) { it.factId }
            if (settlements.size > 1 || settlement?.selectedFactIds?.any { it !in blockFactIds } == true) {
                conflicts += blockId
                return@forEach
            }
            if (settlement == null && (corrections.size > 1 || tombstones.isNotEmpty() && corrections.isNotEmpty())) {
                conflicts += blockId
                return@forEach
            }
            val selected = settlement?.selectedFactIds ?: blockFacts.mapTo(linkedSetOf()) { it.factId }
            if (tombstones.any { it.factId in selected }) return@forEach
            val selectedCorrections = corrections.filter { it.factId in selected }
            if (selectedCorrections.size > 1) {
                conflicts += blockId
                return@forEach
            }
            visible[blockId] = selectedCorrections.singleOrNull()?.replacement ?: creates.single().block
        }
        return MaterializedHistory(visible, alternatives, conflicts)
    }

    fun dailyTotals(history: MaterializedHistory): Map<String, Pair<Long, Int>> =
        history.visible.values.groupBy { it.localDate }.mapValues { (_, blocks) ->
            blocks.sumOf { it.elapsedMillis } to blocks.count { it.outcome == HistoryOutcome.COMPLETED }
        }
}

internal data class SessionTag(
    val tagId: String,
    val name: String,
    val paletteSlot: Int,
    val archived: Boolean = false,
    val mergedInto: String? = null,
)

internal class TagMaterializer(private val workTagId: String) {
    fun apply(
        current: Map<String, SessionTag>,
        next: SessionTag,
        defaultTagId: String,
    ): Pair<Map<String, SessionTag>, String> {
        require(next.name.isNotBlank() && next.paletteSlot >= 0)
        require(next.tagId != workTagId || !next.archived && next.mergedInto == null) { "Work tag is permanent" }
        next.mergedInto?.let { require(it in current && it != next.tagId) }
        val updated = current + (next.tagId to next)
        val default = if (updated[defaultTagId]?.archived == false) defaultTagId else workTagId
        return updated to default
    }
}

internal object DestructiveHistoryGuard {
    const val INDEPENDENT_CONFIRMATION_THRESHOLD: Int = 10

    fun authorize(
        targetBlockIds: Set<String>,
        confirmationScope: Set<String>,
    ): Boolean =
        targetBlockIds.isNotEmpty() &&
            (targetBlockIds.size < INDEPENDENT_CONFIRMATION_THRESHOLD || targetBlockIds == confirmationScope)
}
