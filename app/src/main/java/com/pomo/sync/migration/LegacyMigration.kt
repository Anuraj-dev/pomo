package com.pomo.sync.migration

internal enum class LegacyDisposition { VALID, DUPLICATE, CONFLICTING, MALFORMED_QUARANTINED, MEMBER_EXCLUDED }
internal data class LegacyInventoryItem(val sourceId: String, val durableId: String, val domain: String, val disposition: LegacyDisposition, val detail: String)
internal data class MigrationInventory(val sourceId: String, val items: List<LegacyInventoryItem>, val durableItemCount: Int) {
    init {
        require(sourceId.isNotBlank())
        require(items.size == durableItemCount) { "Every durable legacy item requires an explicit disposition" }
        require(items.map { it.durableId }.distinct().size == items.size)
    }
}

internal enum class LegacyTimerState { PARKED, RUNNING, PAUSED }
internal data class MigrationIdentity(val memberId: String, val crewIds: Set<String>)
internal data class MigrationVerification(val expectedItems: Int, val explainedItems: Int, val projectionRootsMatch: Boolean, val domainInvariantsHold: Boolean)
internal data class MigrationPrerequisites(
    val recoveryAnchorId: String?,
    val baselineCaughtUp: Boolean,
    val timerState: LegacyTimerState,
    val identitiesSelected: Boolean,
    val verification: MigrationVerification,
)
internal enum class MigrationPhase { INVENTORIED, PROPOSED, READY, ACTIVATED, FAILED }
internal data class MigrationActivation(
    val journalId: String,
    val encryptedLegacyArchiveId: String,
    val phase: MigrationPhase,
    val dualWriteRetired: Boolean,
)

internal fun requireIdentitySelection(sources: Collection<MigrationIdentity>, selectedMemberId: String?) {
    val members = sources.map { it.memberId }.toSet()
    val crews = sources.flatMap { it.crewIds }.toSet()
    require(members.size <= 1 || selectedMemberId in members) { "Different Members require explicit selection and cannot be blended" }
    require(crews.size <= 1 || selectedMemberId != null) { "Different Crews require explicit selection and cannot be blended" }
}

internal fun verifyMigrationReady(prerequisites: MigrationPrerequisites) {
    require(!prerequisites.recoveryAnchorId.isNullOrBlank()) { "Recovery artifact and anchor must predate authority changes" }
    require(prerequisites.baselineCaughtUp) { "Trusted baseline must catch up before proposals" }
    require(prerequisites.timerState == LegacyTimerState.PARKED) { "Legacy timer must be Parked" }
    require(prerequisites.identitiesSelected)
    require(prerequisites.verification.expectedItems == prerequisites.verification.explainedItems) { "zero unexplained omissions required" }
    require(prerequisites.verification.projectionRootsMatch && prerequisites.verification.domainInvariantsHold)
}

internal fun activateMigrationAtomically(prerequisites: MigrationPrerequisites, journalId: String, archiveId: String): MigrationActivation {
    verifyMigrationReady(prerequisites)
    require(journalId.isNotBlank() && archiveId.isNotBlank())
    return MigrationActivation(journalId, archiveId, MigrationPhase.ACTIVATED, dualWriteRetired = true)
}

internal const val POMO_BACKUP_V1_WARNING = "Legacy import only: pomo-backup v1 may contain sensitive identity and Crew data; it never activates sync authority."
