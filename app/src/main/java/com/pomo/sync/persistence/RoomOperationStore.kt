package com.pomo.sync.persistence

import com.pomo.db.AppDatabase
import com.pomo.sync.crypto.CoseOperationWire
import com.pomo.sync.protocol.AuthenticatedOperation
import com.pomo.sync.protocol.DomainPayload
import com.pomo.sync.protocol.IngestDisposition
import com.pomo.sync.protocol.KernelCheckpoint
import com.pomo.sync.protocol.OperationCommit
import com.pomo.sync.protocol.OperationStore

internal enum class SyncCommitBoundary {
    BEFORE_OPERATION,
    AFTER_OPERATION,
    AFTER_QUARANTINE,
    AFTER_HEAD,
    AFTER_PROJECTION_CLEAR,
    AFTER_PROJECTION,
    AFTER_OUTBOX,
    AFTER_DISPOSITION,
    BEFORE_COMMIT,
}

internal fun interface SyncFaultInjector {
    fun at(boundary: SyncCommitBoundary)
}

internal data class SyncRestartSnapshot(
    val operations: List<SyncOperationEntity>,
    val heads: List<SyncFeedHeadEntity>,
    val projection: List<SyncPreferenceProjectionEntity>,
    val pendingOutbox: List<SyncOutboxEntity>,
    val dispositionCounts: Map<String, Int>,
)

/** Dormant Room implementation of the #102 kernel's durable commit seam. */
internal class RoomOperationStore(
    private val database: AppDatabase,
    private val faultInjector: SyncFaultInjector = SyncFaultInjector { },
) : OperationStore {
    private val dao: SyncDao = database.syncDao()

    override fun commitBatch(commits: List<OperationCommit>) {
        database.runInTransaction {
            commits.forEach { commit ->
                val existing = dao.operation(commit.operation.operationId.toString())
                val transitionPending =
                    existing?.disposition in
                        setOf(IngestDisposition.PENDING_GAP.name, IngestDisposition.PENDING_CAUSAL.name) &&
                        commit.disposition !in
                        setOf(
                            IngestDisposition.PENDING_GAP,
                            IngestDisposition.PENDING_CAUSAL,
                            IngestDisposition.DUPLICATE,
                        )
                commitInTransaction(
                    commit.operation,
                    commit.disposition,
                    commit.localAuthor,
                    transitionPending = transitionPending,
                )
            }
        }
    }

    override fun restore(
        checkpoint: KernelCheckpoint,
        trailing: List<AuthenticatedOperation>,
    ) {
        database.runInTransaction {
            val retainedOperationIds =
                checkpoint.feeds.flatMap { it.coveredOperationIds }.map { it.toString() }.toSet() +
                    trailing.map { it.operationId.toString() }
            val rebuildableDispositions =
                setOf(
                    IngestDisposition.ACCEPTED.name,
                    IngestDisposition.PENDING_GAP.name,
                    IngestDisposition.PENDING_CAUSAL.name,
                )
            dao.allOperations()
                .filter { it.operationId !in retainedOperationIds && it.disposition in rebuildableDispositions }
                .forEach { dao.updateDisposition(it.operationId, IngestDisposition.QUARANTINED_FORK.name) }
            dao.clearHeads()
            dao.clearCheckpointOperations()
            checkpoint.feeds.forEach { feed ->
                val deviceId = feed.deviceId.toString()
                val incarnationId = feed.incarnationId.toString()
                dao.deleteCheckpointTail(deviceId, incarnationId, 1)
                dao.insertCheckpointOperations(
                    feed.coveredOperationIds.mapIndexed { index, operationId ->
                        SyncCheckpointOperationEntity(deviceId, incarnationId, index + 1L, operationId.toString())
                    },
                )
                dao.upsertHead(
                    SyncFeedHeadEntity(
                        deviceId,
                        incarnationId,
                        feed.coveredOperationIds.size.toLong(),
                        feed.coveredOperationIds.lastOrNull()?.toString(),
                        forkedAt = null,
                    ),
                )
            }
            dao.clearCheckpointProjection()
            checkpoint.materializedPreferences.forEach { preference ->
                dao.insertCheckpointProjection(
                    SyncCheckpointProjectionEntity(preference.key, preference.value),
                )
            }
            trailing.forEach { operation ->
                commitInTransaction(
                    operation,
                    IngestDisposition.ACCEPTED,
                    localAuthor = false,
                    transitionPending = false,
                )
            }
            rebuildProjection()
        }
    }

    fun commit(
        operation: AuthenticatedOperation,
        disposition: IngestDisposition,
        localAuthor: Boolean,
    ) {
        commit(operation, disposition, localAuthor, emptyList())
    }

    fun transitionPending(
        operation: AuthenticatedOperation,
        disposition: IngestDisposition,
    ) {
        database.runInTransaction {
            commitInTransaction(operation, disposition, localAuthor = false, transitionPending = true)
        }
    }

    override fun reject(
        signedEnvelope: ByteArray,
        disposition: IngestDisposition,
    ) {
        require(
            disposition == IngestDisposition.REJECTED_INVALID ||
                disposition == IngestDisposition.REJECTED_UNSUPPORTED_SUITE,
        ) { "Raw wire disposition must be Rejected" }
        database.runInTransaction {
            dao.insertDisposition(
                SyncDispositionEventEntity(
                    operationId = null,
                    disposition = disposition.name,
                    signedWire = signedEnvelope.copyOf(),
                ),
            )
            faultInjector.at(SyncCommitBoundary.AFTER_DISPOSITION)
            faultInjector.at(SyncCommitBoundary.BEFORE_COMMIT)
        }
    }

    fun recordRejected(rawWire: ByteArray) {
        reject(rawWire, IngestDisposition.REJECTED_INVALID)
    }

    fun markDelivered(operationId: String) {
        require(operationId.matches(Regex("[0-9a-f]{64}"))) { "Operation ID must be lowercase hex" }
        database.runInTransaction {
            check(dao.deleteOutbox(operationId) == 1) { "Unknown delivery obligation" }
        }
    }

    fun restartSnapshot(): SyncRestartSnapshot {
        val counts = dao.dispositionCounts().associate { it.disposition to it.count }
        return SyncRestartSnapshot(
            operations = dao.allOperations(),
            heads = dao.allHeads(),
            projection = dao.projection(),
            pendingOutbox = dao.pendingOutbox(),
            dispositionCounts = IngestDisposition.entries.associate { it.name to (counts[it.name] ?: 0) },
        )
    }

    private fun commitInTransaction(
        authenticated: AuthenticatedOperation,
        disposition: IngestDisposition,
        localAuthor: Boolean,
        transitionPending: Boolean,
    ) {
        val operationId = authenticated.operationId.toString()
        val existing = dao.operation(operationId)
        val reclassifyingAcceptedFork =
            existing?.disposition == IngestDisposition.ACCEPTED.name &&
                disposition == IngestDisposition.QUARANTINED_FORK
        if (existing != null) {
            validateSameOperation(existing, authenticated)
            if (!transitionPending && !reclassifyingAcceptedFork) {
                dao.insertDisposition(event(authenticated, IngestDisposition.DUPLICATE))
                faultInjector.at(SyncCommitBoundary.AFTER_DISPOSITION)
                faultInjector.at(SyncCommitBoundary.BEFORE_COMMIT)
                return
            }
            if (transitionPending) {
                require(
                    existing.disposition == IngestDisposition.PENDING_GAP.name ||
                        existing.disposition == IngestDisposition.PENDING_CAUSAL.name,
                ) { "Only a persisted Pending Operation can transition" }
                require(
                    disposition != IngestDisposition.PENDING_GAP &&
                        disposition != IngestDisposition.PENDING_CAUSAL &&
                        disposition != IngestDisposition.DUPLICATE,
                ) { "Pending transition must resolve to a terminal disposition" }
            }
        } else {
            require(!transitionPending) { "Cannot transition an unknown Pending Operation" }
        }
        val effectiveLocalAuthor = existing?.localAuthor ?: localAuthor
        require(
            !effectiveLocalAuthor ||
                disposition == IngestDisposition.ACCEPTED ||
                disposition == IngestDisposition.PENDING_GAP ||
                disposition == IngestDisposition.PENDING_CAUSAL ||
                (reclassifyingAcceptedFork && disposition == IngestDisposition.QUARANTINED_FORK),
        ) {
            "Local Operation must be Accepted or Pending"
        }

        val entity = entity(authenticated, disposition, effectiveLocalAuthor)
        faultInjector.at(SyncCommitBoundary.BEFORE_OPERATION)
        persistOperation(existing, entity, disposition)

        when (disposition) {
            IngestDisposition.ACCEPTED -> accept(entity, effectiveLocalAuthor)
            IngestDisposition.QUARANTINED_FORK -> quarantineFork(entity)
            IngestDisposition.DUPLICATE -> error("New Operation cannot have Duplicate disposition")
            IngestDisposition.PENDING_GAP,
            IngestDisposition.PENDING_CAUSAL,
            IngestDisposition.REJECTED_INVALID,
            IngestDisposition.REJECTED_UNSUPPORTED_SUITE,
            -> Unit
        }

        dao.insertDisposition(event(authenticated, disposition))
        faultInjector.at(SyncCommitBoundary.AFTER_DISPOSITION)
        faultInjector.at(SyncCommitBoundary.BEFORE_COMMIT)
    }

    private fun persistOperation(
        existing: SyncOperationEntity?,
        entity: SyncOperationEntity,
        disposition: IngestDisposition,
    ) {
        if (existing == null) {
            if (
                disposition != IngestDisposition.REJECTED_INVALID &&
                disposition != IngestDisposition.REJECTED_UNSUPPORTED_SUITE
            ) {
                check(dao.insertOperation(entity) != -1L) { "Operation ID raced during commit" }
                faultInjector.at(SyncCommitBoundary.AFTER_OPERATION)
            }
        } else if (
            disposition == IngestDisposition.REJECTED_INVALID ||
            disposition == IngestDisposition.REJECTED_UNSUPPORTED_SUITE
        ) {
            check(dao.deleteOperation(entity.operationId) == 1)
            faultInjector.at(SyncCommitBoundary.AFTER_OPERATION)
        } else {
            check(dao.updateDisposition(entity.operationId, disposition.name) == 1)
            faultInjector.at(SyncCommitBoundary.AFTER_OPERATION)
        }
    }

    private fun accept(
        entity: SyncOperationEntity,
        localAuthor: Boolean,
    ) {
        dao.upsertHead(
            SyncFeedHeadEntity(
                entity.deviceId,
                entity.incarnationId,
                entity.sequence,
                entity.operationId,
                forkedAt = null,
            ),
        )
        faultInjector.at(SyncCommitBoundary.AFTER_HEAD)
        rebuildProjection()
        faultInjector.at(SyncCommitBoundary.AFTER_PROJECTION)
        if (localAuthor) {
            check(dao.insertOutbox(SyncOutboxEntity(entity.operationId, entity.signedWire.copyOf())) != -1L)
        }
        faultInjector.at(SyncCommitBoundary.AFTER_OUTBOX)
    }

    private fun quarantineFork(incoming: SyncOperationEntity) {
        val durableHead = dao.head(incoming.deviceId, incoming.incarnationId)
        val effectiveForkAt = minOf(durableHead?.forkedAt ?: incoming.sequence, incoming.sequence)
        dao.quarantineTail(incoming.deviceId, incoming.incarnationId, effectiveForkAt)
        val checkpointOperationCount = dao.checkpointOperationCount()
        dao.deleteCheckpointTail(incoming.deviceId, incoming.incarnationId, effectiveForkAt)
        if (dao.checkpointOperationCount() < checkpointOperationCount) dao.clearCheckpointProjection()
        faultInjector.at(SyncCommitBoundary.AFTER_QUARANTINE)
        val prefixSequence = minOf(durableHead?.sequence ?: 0, effectiveForkAt - 1)
        val prefix =
            if (prefixSequence > 0) {
                dao.acceptedAt(incoming.deviceId, incoming.incarnationId, prefixSequence)?.operationId
                    ?: dao.checkpointOperationAt(incoming.deviceId, incoming.incarnationId, prefixSequence)
                    ?: error("Fork prefix must reference an accepted or checkpoint Operation")
            } else {
                null
            }
        dao.upsertHead(
            SyncFeedHeadEntity(
                incoming.deviceId,
                incoming.incarnationId,
                prefixSequence,
                prefix,
                forkedAt = effectiveForkAt,
            ),
        )
        faultInjector.at(SyncCommitBoundary.AFTER_HEAD)
        rebuildProjection()
        faultInjector.at(SyncCommitBoundary.AFTER_PROJECTION)
        faultInjector.at(SyncCommitBoundary.AFTER_OUTBOX)
    }

    private fun rebuildProjection() {
        dao.clearProjection()
        faultInjector.at(SyncCommitBoundary.AFTER_PROJECTION_CLEAR)
        dao.checkpointProjection().forEach { projection ->
            dao.upsertProjection(
                SyncPreferenceProjectionEntity(
                    projection.preferenceKey,
                    projection.preferenceValue,
                    operationId = "checkpoint:${projection.preferenceKey}",
                ),
            )
        }
        val checkpointOperationIds = dao.checkpointOperationIds().toSet()
        causalMaterializationOrder(
            dao.acceptedOperations().filterNot { operation -> operation.operationId in checkpointOperationIds },
        ).forEach { operation ->
            if (operation.preferenceKey.isEmpty()) return@forEach
            dao.upsertProjection(
                SyncPreferenceProjectionEntity(
                    operation.preferenceKey,
                    operation.preferenceValue,
                    operation.operationId,
                ),
            )
        }
    }

    private fun causalMaterializationOrder(operations: List<SyncOperationEntity>): List<SyncOperationEntity> {
        val byId = operations.associateBy { it.operationId }
        val dependencies =
            operations.associate { operation ->
                val parsed = runCatching { CoseOperationWire.unsignedOperation(operation.signedWire) }.getOrNull()
                operation.operationId to
                    buildSet {
                        operation.previousOperationId?.takeIf(byId::containsKey)?.let(::add)
                        parsed?.frontier?.map { it.headOperationId.toString() }
                            ?.filter(byId::containsKey)
                            ?.forEach(::add)
                    }
            }
        val indegree = dependencies.mapValues { (_, required) -> required.size }.toMutableMap()
        val dependents = mutableMapOf<String, MutableList<String>>()
        dependencies.forEach { (operationId, required) ->
            required.forEach { dependency -> dependents.getOrPut(dependency) { mutableListOf() }.add(operationId) }
        }
        val ready = operations.filter { indegree[it.operationId] == 0 }.sortedBy { it.operationId }.toMutableList()
        val ordered = mutableListOf<SyncOperationEntity>()
        while (ready.isNotEmpty()) {
            val operation = ready.removeAt(0)
            ordered += operation
            dependents[operation.operationId].orEmpty().forEach { dependent ->
                val remaining = indegree.getValue(dependent) - 1
                indegree[dependent] = remaining
                if (remaining == 0) ready += byId.getValue(dependent)
            }
            ready.sortBy { it.operationId }
        }
        if (ordered.size != operations.size) ordered += operations.filterNot(ordered::contains).sortedBy { it.operationId }
        return ordered
    }

    private fun validateSameOperation(
        existing: SyncOperationEntity,
        authenticated: AuthenticatedOperation,
    ) {
        require(existing.signedWire.contentEquals(authenticated.signedEnvelope)) {
            "Operation ID collision has different authenticated bytes"
        }
        require(existing.deviceId == authenticated.operation.deviceId.toString())
        require(existing.incarnationId == authenticated.operation.incarnationId.toString())
        require(existing.sequence == authenticated.operation.sequence)
    }

    private fun entity(
        authenticated: AuthenticatedOperation,
        disposition: IngestDisposition,
        localAuthor: Boolean,
    ): SyncOperationEntity {
        val preference =
            DomainPayload.preferenceProjectionOrEmpty(
                authenticated.operation.kind,
                authenticated.canonicalPayload,
            )
        return SyncOperationEntity(
            operationId = authenticated.operationId.toString(),
            memberId = authenticated.operation.memberId.toString(),
            deviceId = authenticated.operation.deviceId.toString(),
            incarnationId = authenticated.operation.incarnationId.toString(),
            sequence = authenticated.operation.sequence,
            previousOperationId = authenticated.operation.previousOperationId?.toString(),
            signedWire = authenticated.signedEnvelope.copyOf(),
            preferenceKey = preference.first,
            preferenceValue = preference.second,
            disposition = disposition.name,
            localAuthor = localAuthor,
        )
    }

    private fun event(
        operation: AuthenticatedOperation,
        disposition: IngestDisposition,
    ): SyncDispositionEventEntity =
        SyncDispositionEventEntity(
            operationId = operation.operationId.toString(),
            disposition = disposition.name,
            signedWire = operation.signedEnvelope.copyOf(),
        )
}
