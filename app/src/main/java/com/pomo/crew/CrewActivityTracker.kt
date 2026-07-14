package com.pomo.crew

/** Something a crew mate did that is worth a glance in the shade. */
public sealed interface CrewActivityEvent {
    public val identityPublicKey: String
    public val displayName: String

    public data class StartedFocus(
        override val identityPublicKey: String,
        override val displayName: String,
        val endsAtEpochSeconds: Long,
    ) : CrewActivityEvent

    public data class CompletedBlock(
        override val identityPublicKey: String,
        override val displayName: String,
        val todayWorkBlocks: Int,
    ) : CrewActivityEvent
}

/**
 * Turns the stream of relay snapshots into the two moments people actually care about: a crew mate
 * sitting down to focus, and a crew mate finishing a block.
 *
 * Relays replay: the same snapshot can arrive twice, and an old one can arrive late. So the tracker
 * remembers what it last saw per member and only speaks on a real change — and a start is only
 * announced while it is still fresh, so a snapshot from an hour ago cannot claim someone just began.
 */
public class CrewActivityTracker(private val selfIdentityPublicKey: String) {
    private val seen = mutableMapOf<String, MemberActivity>()

    /** Prime from the board already on disk, so the first live event is a diff, not a flood. */
    public fun seed(rows: List<CrewBoardRow>) {
        rows.forEach { row ->
            seen[row.identityPublicKey] = MemberActivity(
                localDate = row.localDate,
                workBlocks = row.todaySessionCount,
                presenceStartedAtEpochSeconds = row.presence?.takeIf { it.isWork }
                    ?.startedAtEpochSeconds ?: 0L,
            )
        }
    }

    public fun observe(snapshot: CrewSnapshot, nowEpochSeconds: Long): List<CrewActivityEvent> {
        if (snapshot.identityPublicKey == selfIdentityPublicKey) return emptyList()
        if (!CrewValidation.isValidSnapshot(snapshot)) return emptyList()

        val workBlocks = snapshot.dailyAggregates
            .firstOrNull { it.localDate == snapshot.localDate }
            ?.completedWorkBlocks
            ?: 0
        val presence = snapshot.presence?.takeIf { it.isWork && it.isLiveAt(nowEpochSeconds) }
        val startedAt = presence?.startedAtEpochSeconds ?: 0L
        val previous = seen[snapshot.identityPublicKey]
        seen[snapshot.identityPublicKey] = MemberActivity(
            localDate = snapshot.localDate,
            workBlocks = workBlocks,
            presenceStartedAtEpochSeconds = startedAt,
        )

        val events = mutableListOf<CrewActivityEvent>()
        val isNewStart = startedAt > 0L &&
            startedAt != previous?.presenceStartedAtEpochSeconds &&
            nowEpochSeconds - startedAt <= FRESH_START_SECONDS
        if (isNewStart && presence != null) {
            events += CrewActivityEvent.StartedFocus(
                identityPublicKey = snapshot.identityPublicKey,
                displayName = snapshot.displayName,
                endsAtEpochSeconds = presence.endsAtEpochSeconds,
            )
        }
        val finishedBlock = previous != null &&
            previous.localDate == snapshot.localDate &&
            workBlocks > previous.workBlocks
        if (finishedBlock) {
            events += CrewActivityEvent.CompletedBlock(
                identityPublicKey = snapshot.identityPublicKey,
                displayName = snapshot.displayName,
                todayWorkBlocks = workBlocks,
            )
        }
        return events
    }

    private data class MemberActivity(
        val localDate: String,
        val workBlocks: Int,
        val presenceStartedAtEpochSeconds: Long,
    )

    public companion object {
        /** A start older than this is history, not news. */
        public const val FRESH_START_SECONDS: Long = 5L * 60L
    }
}
