package com.pomo.crew

public data class CrewIdentity(
    val privateKey: String,
    val publicKey: String,
)

public data class CrewJoinPayload(
    val crewId: String,
    val crewName: String,
    val relays: List<String>,
    val key: String,
    val version: Int = CrewDefaults.PROTOCOL_VERSION,
)

public data class CrewJoinPreview(
    val activeMembers: Int,
    val todayFocusMinutes: Int,
    val medianMemberFocusMinutes: Int,
    val knownDisplayNames: Set<String>,
)

public data class CrewDailyAggregate(
    val localDate: String,
    val focusMinutes: Int,
    val completedWorkBlocks: Int,
)

public data class CrewSnapshot(
    val crewId: String,
    val identityPublicKey: String,
    val displayName: String,
    val allTimeFocusMinutes: Int,
    val publishedAtEpochSeconds: Long,
    val localDate: String,
    val utcOffsetMinutes: Int,
    val dailyAggregates: List<CrewDailyAggregate>,
    val currentStreak: Int,
    val lastFocusedAtEpochSeconds: Long,
    val version: Int = CrewDefaults.PROTOCOL_VERSION,
) {
    public val todayFocusMinutes: Int
        get() = dailyAggregates.firstOrNull { it.localDate == localDate }?.focusMinutes ?: 0

    public val todaySessionCount: Int
        get() = dailyAggregates.firstOrNull { it.localDate == localDate }?.completedWorkBlocks ?: 0
}

public data class CrewBoardRow(
    val rank: Int?,
    val identityPublicKey: String,
    val displayName: String,
    val allTimeFocusMinutes: Int,
    val todayFocusMinutes: Int,
    val sevenDayFocusMinutes: Int,
    val thirtyDayFocusMinutes: Int,
    val selectedFocusMinutes: Int,
    val currentStreak: Int,
    val todaySessionCount: Int,
    val lastFocusedAtEpochSeconds: Long,
    val dailyAggregates: List<CrewDailyAggregate>,
    val isSelf: Boolean,
    val isStale: Boolean = false,
    val isInactive: Boolean = false,
)

/**
 * The window the leaderboard ranks over. [Day] covers any single past date; snapshots carry
 * [CrewValidation.MAX_DAILY_AGGREGATES] days of history, so dates older than that rank as zero.
 */
public sealed interface CrewRankingMode {
    public data object Today : CrewRankingMode

    public data object Yesterday : CrewRankingMode

    public data object SevenDays : CrewRankingMode

    public data object ThirtyDays : CrewRankingMode

    public data object AllTime : CrewRankingMode

    public data class Day(val localDate: String) : CrewRankingMode
}

public data class CrewBoard(
    val crewId: String,
    val crewName: String,
    val joinCode: String,
    val rows: List<CrewBoardRow>,
    val hiddenMembers: List<CrewHiddenMember> = emptyList(),
    val rankingMode: CrewRankingMode = CrewRankingMode.Today,
    val lastUpdatedEpochSeconds: Long? = null,
    val successfulRelayCount: Int = 0,
    val totalRelayCount: Int = 0,
    val memberships: List<CrewMembershipSummary> = emptyList(),
    val displayName: String = "",
)

public data class CrewHiddenMember(
    val identityPublicKey: String,
    val displayName: String,
    val selectedFocusMinutes: Int,
)

public data class CrewMembership(
    val crewId: String,
    val crewName: String,
    val joinCode: String,
    val relays: List<String>,
    val key: String,
    val displayName: String,
    val protocolVersion: Int = CrewDefaults.PROTOCOL_VERSION,
    val isArchived: Boolean = false,
)

public data class CrewMembershipSummary(
    val crewId: String,
    val crewName: String,
    val displayName: String,
    val isActive: Boolean,
    val isArchived: Boolean = false,
)
