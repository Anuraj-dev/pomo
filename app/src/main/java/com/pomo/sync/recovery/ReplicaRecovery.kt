package com.pomo.sync.recovery

internal data class FrontierHead(val feedKey: String, val sequence: Long, val operationId: String)
internal data class CheckpointManifest(
    val checkpointId: String,
    val kind: String,
    val frontier: List<FrontierHead>,
    val materializerVersion: Int,
    val projectionRoot: String,
    val packIds: List<String>,
    val blobIds: List<String>,
)
internal data class PackedOperation(val operationId: String, val feedKey: String, val sequence: Long, val wire: ByteArray)
internal data class JournalPack(val packId: String, val prefix: FrontierHead, val operations: List<PackedOperation>)

internal object CheckpointPolicy {
    fun validate(manifest: CheckpointManifest) {
        require(manifest.kind in setOf("ROUTINE", "RECOVERY", "SAFETY"))
        require(manifest.frontier == manifest.frontier.sortedBy { it.feedKey })
        require(manifest.frontier.map { it.feedKey }.distinct().size == manifest.frontier.size)
        require(manifest.materializerVersion > 0 && manifest.projectionRoot.isNotBlank())
        require(manifest.packIds.distinct().size == manifest.packIds.size)
        require(manifest.blobIds.distinct().size == manifest.blobIds.size)
    }

    fun validatePack(pack: JournalPack, forkedFeeds: Set<String>) {
        require(pack.prefix.feedKey !in forkedFeeds)
        require(pack.operations.isNotEmpty())
        require(pack.operations.all { it.feedKey == pack.prefix.feedKey })
        require(pack.operations.map { it.sequence } == (1L..pack.prefix.sequence).toList())
        require(pack.operations.last().operationId == pack.prefix.operationId)
        require(pack.operations.map { it.operationId }.distinct().size == pack.operations.size)
    }
}

internal data class RecoverySource(val sourceId: String, val checkpoint: CheckpointManifest?, val operations: List<PackedOperation>)
internal data class RehydrationPlan(
    val checkpoint: CheckpointManifest?,
    val operations: List<PackedOperation>,
    val sourceByOperation: Map<String, Set<String>>,
    val gaps: Set<String>,
)

internal object Rehydrator {
    fun plan(sources: Collection<RecoverySource>): RehydrationPlan {
        val checkpoints = sources.mapNotNull { it.checkpoint }.onEach(CheckpointPolicy::validate)
        val checkpoint = checkpoints.maxWithOrNull(compareBy<CheckpointManifest> { it.frontier.sumOf { head -> head.sequence } }.thenBy { it.checkpointId })
        val operations = sources.flatMap { it.operations }.groupBy { it.operationId }
        operations.forEach { (_, copies) -> require(copies.map { it.wire.toList() }.distinct().size == 1) { "Operation ID collision" } }
        val selected = operations.values.map { it.first() }.sortedWith(compareBy<PackedOperation> { it.feedKey }.thenBy { it.sequence })
        val gaps = linkedSetOf<String>()
        selected.groupBy { it.feedKey }.forEach { (feed, values) ->
            val sequences = values.map { it.sequence }.toSet()
            for (sequence in 1L..(values.maxOfOrNull { it.sequence } ?: 0)) if (sequence !in sequences) gaps += "$feed@$sequence"
        }
        val provenance = operations.mapValues { (_, copies) ->
            sources.filter { source -> copies.any { copy -> source.operations.any { it.operationId == copy.operationId } } }.mapTo(linkedSetOf()) { it.sourceId }
        }
        return RehydrationPlan(checkpoint, selected, provenance, gaps)
    }
}

internal enum class IntegrityFailure { PROJECTION_CORRUPT, JOURNAL_CORRUPT, DEVICE_KEY_MISSING }
internal data class SafeModeState(val active: Boolean, val incarnationSealed: Boolean, val inspectionAllowed: Boolean, val exportAllowed: Boolean)

internal fun integrityDisposition(failure: IntegrityFailure): SafeModeState =
    when (failure) {
        IntegrityFailure.PROJECTION_CORRUPT -> SafeModeState(false, false, true, true)
        IntegrityFailure.JOURNAL_CORRUPT, IntegrityFailure.DEVICE_KEY_MISSING -> SafeModeState(true, true, true, true)
    }

internal fun quarantineThresholdExceeded(quarantined: Int, suspendedFeeds: Int): Boolean = quarantined > 1_000 || suspendedFeeds > 16
