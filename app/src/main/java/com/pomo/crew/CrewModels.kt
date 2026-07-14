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

/**
 * Everything a member shares beyond the leaderboard's own needs, so their stats page can be
 * drawn at the same fidelity as your own.
 *
 * Every field is optional and rides inside protocol version 2: builds that predate it ignore the
 * whole object (Gson drops unknown keys), and builds that postdate a member's build see nulls.
 * Bumping [CrewDefaults.PROTOCOL_VERSION] instead would make older clients reject the snapshot
 * outright and silently drop that member from their board.
 */
public data class CrewStatsExtras(
    /** All-time focus minutes bucketed by hour of day, 24 slots, member's local clock. */
    val hourBuckets: List<Int>? = null,
    /** All-time focus minutes by weekday, 7 slots, Monday first. */
    val weekdayBuckets: List<Int>? = null,
    val allTimeWorkBlocks: Int? = null,
    val bestStreak: Int? = null,
    val firstFocusLocalDate: String? = null,
    /** Dense daily history: index 0 is [historyStartDate], one entry per day up to today. */
    val historyStartDate: String? = null,
    val historyFocusMinutes: List<Int>? = null,
    val historyWorkBlocks: List<Int>? = null,
    /** All-time records, sent whole because the shared history window may not contain them. */
    val bestDayLocalDate: String? = null,
    val bestDayFocusMinutes: Int? = null,
    val bestDayWorkBlocks: Int? = null,
    val bestWeekStartDate: String? = null,
    val bestWeekFocusMinutes: Int? = null,
    val bestWeekWorkBlocks: Int? = null,
)

/**
 * What a member is doing right now, pushed the moment a session starts and cleared when it ends.
 * Carries its own end time so a reader can tell "focusing" from "left the app mid-session" without
 * waiting for another snapshot: once [endsAtEpochSeconds] passes, presence simply expires.
 *
 * Optional, like [CrewStatsExtras], and for the same reason — older builds must keep accepting us.
 */
public data class CrewPresence(
    val phase: String,
    val startedAtEpochSeconds: Long,
    val endsAtEpochSeconds: Long,
) {
    public val isWork: Boolean get() = phase == PHASE_WORK

    public fun isLiveAt(nowEpochSeconds: Long): Boolean =
        nowEpochSeconds in startedAtEpochSeconds..(endsAtEpochSeconds + GRACE_SECONDS)

    public companion object {
        public const val PHASE_WORK: String = "work"
        public const val PHASE_BREAK: String = "break"

        /** A phone that dies mid-session never clears presence; the end time plus this does. */
        public const val GRACE_SECONDS: Long = 120L
        public const val MAX_SESSION_SECONDS: Long = 6L * 60L * 60L
    }
}

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
    val stats: CrewStatsExtras? = null,
    val presence: CrewPresence? = null,
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
    /** The member's own calendar date when they published — their "today", not yours. */
    val localDate: String = "",
    val stats: CrewStatsExtras? = null,
    val presence: CrewPresence? = null,
) {
    /** Are they in a focus block at this instant, as far as their last snapshot can tell us? */
    public fun isFocusingAt(nowEpochSeconds: Long): Boolean =
        presence?.let { it.isWork && it.isLiveAt(nowEpochSeconds) } == true

    public fun focusRemainingSecondsAt(nowEpochSeconds: Long): Long =
        if (isFocusingAt(nowEpochSeconds)) {
            (presence!!.endsAtEpochSeconds - nowEpochSeconds).coerceAtLeast(0L)
        } else {
            0L
        }
}

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
