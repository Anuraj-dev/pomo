package com.pomo.sync.domain

internal data class SharedPreferencePatch(
    val field: String,
    val value: String,
    val operationId: String,
    val effectiveAfterPhaseId: String?,
)

internal object SharedPreferencesMaterializer {
    private val sharedFields =
        setOf("focusMinutes", "shortBreakMinutes", "longBreakMinutes", "longBreakAfter", "defaultTagId")

    fun materialize(patches: Collection<SharedPreferencePatch>): Map<String, SharedPreferencePatch> =
        patches.filter { it.field in sharedFields }
            .groupBy { it.field }
            .mapValues { (_, values) -> values.minBy { it.operationId } }

    fun isDeviceLocal(field: String): Boolean =
        field in setOf(
            "theme",
            "cueMode",
            "notificationPermission",
            "navigation",
            "routeHealth",
            "selectedCrew",
            "hiddenMembers",
        )
}

internal data class ProfileVersion(
    val operationId: String,
    val name: String,
    val photoBlobId: String?,
)

internal data class ProfileProjection(
    val complete: ProfileVersion?,
    val pending: ProfileVersion?,
)

internal object ProfileMaterializer {
    fun apply(current: ProfileProjection, incoming: ProfileVersion, verifiedBlobIds: Set<String>): ProfileProjection =
        if (incoming.photoBlobId == null || incoming.photoBlobId in verifiedBlobIds) {
            ProfileProjection(incoming, null)
        } else {
            ProfileProjection(current.complete, incoming)
        }
}

internal enum class MembershipIntent {
    JOIN,
    LEAVE,
}

internal data class CrewMembershipFact(
    val operationId: String,
    val crewId: String,
    val intent: MembershipIntent,
)

internal data class CrewMembershipProjection(
    val joined: Boolean?,
    val decisionRequired: Boolean,
    val publicationPaused: Boolean,
)

internal object CrewMembershipMaterializer {
    fun materialize(facts: Collection<CrewMembershipFact>): CrewMembershipProjection {
        val intents = facts.map { it.intent }.toSet()
        if (intents.size > 1) return CrewMembershipProjection(null, true, true)
        return CrewMembershipProjection(intents.singleOrNull() == MembershipIntent.JOIN, false, false)
    }

    fun pseudonym(memberSecret: ByteArray, crewId: String): String {
        require(memberSecret.size >= 32 && crewId.isNotBlank())
        val digest =
            java.security.MessageDigest.getInstance("SHA-256").digest(memberSecret + crewId.toByteArray())
        return digest.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }
}

internal enum class DataFamilyDisposition {
    ACCEPTED,
    PENDING_FORWARD,
}

internal fun classifyDataFamily(version: Int): DataFamilyDisposition =
    if (version == 1) DataFamilyDisposition.ACCEPTED else DataFamilyDisposition.PENDING_FORWARD
