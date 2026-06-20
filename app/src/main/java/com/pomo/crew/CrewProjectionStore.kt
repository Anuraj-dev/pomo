package com.pomo.crew

import android.content.Context
import com.pomo.db.AppDatabase
import com.pomo.db.CrewDailyAggregateEntity
import com.pomo.db.CrewHiddenMemberEntity
import com.pomo.db.CrewRelayStateEntity
import com.pomo.db.CrewSnapshotEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

public data class CrewProjection(
    val snapshots: List<CrewSnapshot>,
    val hiddenIdentityPublicKeys: Set<String>,
    val relayStates: List<CrewRelayStateEntity>,
)

public class CrewProjectionStore(context: Context) {
    private val dao = AppDatabase.getInstance(context.applicationContext).crewDao()

    public fun observe(crewId: String): Flow<CrewProjection> =
        combine(
            dao.observeSnapshots(crewId),
            dao.observeDailyAggregates(crewId),
            dao.observeHiddenMembers(crewId),
            dao.observeRelayStates(crewId),
        ) { snapshots, aggregates, hiddenMembers, relayStates ->
            CrewProjection(
                snapshots = snapshots.toModels(aggregates),
                hiddenIdentityPublicKeys = hiddenMembers.mapTo(mutableSetOf()) { it.identityPublicKey },
                relayStates = relayStates,
            )
        }

    public suspend fun load(crewId: String): CrewProjection {
        val snapshots = dao.getSnapshots(crewId)
        val aggregates = dao.getDailyAggregates(crewId)
        return CrewProjection(
            snapshots = snapshots.toModels(aggregates),
            hiddenIdentityPublicKeys = dao.getHiddenMembers(crewId).mapTo(mutableSetOf()) { it.identityPublicKey },
            relayStates = dao.getRelayStates(crewId),
        )
    }

    public suspend fun upsertLatest(snapshot: CrewSnapshot): Boolean {
        require(CrewValidation.isValidSnapshot(snapshot))
        return dao.upsertLatest(
            snapshot = snapshot.toEntity(),
            aggregates = snapshot.dailyAggregates.map { it.toEntity(snapshot) },
        )
    }

    public suspend fun setHidden(crewId: String, identityPublicKey: String, hidden: Boolean) {
        if (hidden) {
            dao.upsertHiddenMember(
                CrewHiddenMemberEntity(
                    crewId = crewId,
                    identityPublicKey = identityPublicKey,
                    hiddenAtEpochSeconds = System.currentTimeMillis() / 1000L,
                ),
            )
        } else {
            dao.unhideMember(crewId, identityPublicKey)
        }
    }

    public suspend fun recordRelayResult(crewId: String, relayUrl: String, error: String?) {
        val now = System.currentTimeMillis() / 1000L
        dao.upsertRelayState(
            CrewRelayStateEntity(
                crewId = crewId,
                relayUrl = relayUrl,
                lastAttemptEpochSeconds = now,
                lastSuccessEpochSeconds = if (error == null) now else null,
                lastError = error,
            ),
        )
    }

    public suspend fun delete(crewId: String) {
        dao.deleteCrewProjection(crewId)
    }

    private fun List<CrewSnapshotEntity>.toModels(
        aggregates: List<CrewDailyAggregateEntity>,
    ): List<CrewSnapshot> {
        val aggregatesByMember = aggregates.groupBy { it.crewId to it.identityPublicKey }
        return map { snapshot ->
            CrewSnapshot(
                crewId = snapshot.crewId,
                identityPublicKey = snapshot.identityPublicKey,
                displayName = snapshot.displayName,
                allTimeFocusMinutes = snapshot.allTimeFocusMinutes,
                publishedAtEpochSeconds = snapshot.publishedAtEpochSeconds,
                localDate = snapshot.localDate,
                utcOffsetMinutes = snapshot.utcOffsetMinutes,
                dailyAggregates = aggregatesByMember[snapshot.crewId to snapshot.identityPublicKey]
                    .orEmpty()
                    .map { it.toModel() }
                    .sortedByDescending { it.localDate },
                currentStreak = snapshot.currentStreak,
                lastFocusedAtEpochSeconds = snapshot.lastFocusedAtEpochSeconds,
                version = snapshot.protocolVersion,
            )
        }
    }

    private fun CrewSnapshot.toEntity(): CrewSnapshotEntity = CrewSnapshotEntity(
        crewId = crewId,
        identityPublicKey = identityPublicKey,
        displayName = displayName,
        allTimeFocusMinutes = allTimeFocusMinutes,
        publishedAtEpochSeconds = publishedAtEpochSeconds,
        localDate = localDate,
        utcOffsetMinutes = utcOffsetMinutes,
        currentStreak = currentStreak,
        lastFocusedAtEpochSeconds = lastFocusedAtEpochSeconds,
        protocolVersion = version,
    )

    private fun CrewDailyAggregate.toEntity(snapshot: CrewSnapshot): CrewDailyAggregateEntity =
        CrewDailyAggregateEntity(
            crewId = snapshot.crewId,
            identityPublicKey = snapshot.identityPublicKey,
            localDate = localDate,
            focusMinutes = focusMinutes,
            completedWorkBlocks = completedWorkBlocks,
        )

    private fun CrewDailyAggregateEntity.toModel(): CrewDailyAggregate = CrewDailyAggregate(
        localDate = localDate,
        focusMinutes = focusMinutes,
        completedWorkBlocks = completedWorkBlocks,
    )
}
