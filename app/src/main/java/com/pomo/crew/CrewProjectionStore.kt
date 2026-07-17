package com.pomo.crew

import android.content.Context
import com.google.gson.Gson
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
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()

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

    public suspend fun setHidden(
        crewId: String,
        identityPublicKey: String,
        hidden: Boolean,
    ) {
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

    public suspend fun recordRelayResult(
        crewId: String,
        relayUrl: String,
        error: String?,
    ) {
        val now = System.currentTimeMillis() / 1000L
        val previousSuccess = dao.getRelayState(crewId, relayUrl)?.lastSuccessEpochSeconds
        dao.upsertRelayState(
            CrewRelayStateEntity(
                crewId = crewId,
                relayUrl = relayUrl,
                lastAttemptEpochSeconds = now,
                lastSuccessEpochSeconds = if (error == null) now else previousSuccess,
                lastError = error,
            ),
        )
    }

    public suspend fun delete(crewId: String) {
        dao.deleteCrewProjection(crewId)
        clearLastPublishSuccess(crewId)
    }

    public fun lastPublishSuccessEpochSeconds(crewId: String): Long? =
        if (prefs.contains(lastPublishSuccessKey(crewId))) prefs.getLong(lastPublishSuccessKey(crewId), 0L) else null

    public suspend fun recordPublishResult(
        crewId: String,
        result: CrewRelayPublishResult,
        nowEpochSeconds: Long,
    ) {
        recordRelayResult(crewId, result.relayUrl, result.error)
        if (result.accepted) {
            prefs.edit().putLong(lastPublishSuccessKey(crewId), nowEpochSeconds).apply()
        }
    }

    public fun clearLastPublishSuccess(crewId: String) {
        prefs.edit().remove(lastPublishSuccessKey(crewId)).apply()
    }

    private fun List<CrewSnapshotEntity>.toModels(aggregates: List<CrewDailyAggregateEntity>): List<CrewSnapshot> {
        val aggregatesByMember = aggregates.groupBy { it.crewId to it.identityPublicKey }
        return map { snapshot ->
            CrewSnapshot(
                crewId = snapshot.crewId,
                identityPublicKey = snapshot.identityPublicKey,
                displayName = snapshot.displayName,
                avatarBase64 = snapshot.avatarBase64,
                allTimeFocusMinutes = snapshot.allTimeFocusMinutes,
                publishedAtEpochSeconds = snapshot.publishedAtEpochSeconds,
                localDate = snapshot.localDate,
                utcOffsetMinutes = snapshot.utcOffsetMinutes,
                dailyAggregates =
                    aggregatesByMember[snapshot.crewId to snapshot.identityPublicKey]
                        .orEmpty()
                        .map { it.toModel() }
                        .sortedByDescending { it.localDate },
                currentStreak = snapshot.currentStreak,
                lastFocusedAtEpochSeconds = snapshot.lastFocusedAtEpochSeconds,
                version = snapshot.protocolVersion,
                stats =
                    snapshot.statsJson?.let { json ->
                        runCatching { gson.fromJson(json, CrewStatsExtras::class.java) }.getOrNull()
                    },
            )
        }
    }

    private fun CrewSnapshot.toEntity(): CrewSnapshotEntity =
        CrewSnapshotEntity(
            crewId = crewId,
            identityPublicKey = identityPublicKey,
            displayName = displayName,
            avatarBase64 = avatarBase64,
            allTimeFocusMinutes = allTimeFocusMinutes,
            publishedAtEpochSeconds = publishedAtEpochSeconds,
            localDate = localDate,
            utcOffsetMinutes = utcOffsetMinutes,
            currentStreak = currentStreak,
            lastFocusedAtEpochSeconds = lastFocusedAtEpochSeconds,
            protocolVersion = version,
            statsJson = stats?.let { gson.toJson(it) },
        )

    private fun CrewDailyAggregate.toEntity(snapshot: CrewSnapshot): CrewDailyAggregateEntity =
        CrewDailyAggregateEntity(
            crewId = snapshot.crewId,
            identityPublicKey = snapshot.identityPublicKey,
            localDate = localDate,
            focusMinutes = focusMinutes,
            completedWorkBlocks = completedWorkBlocks,
        )

    private fun CrewDailyAggregateEntity.toModel(): CrewDailyAggregate =
        CrewDailyAggregate(
            localDate = localDate,
            focusMinutes = focusMinutes,
            completedWorkBlocks = completedWorkBlocks,
        )

    private fun lastPublishSuccessKey(crewId: String): String = "crew_publish_success_$crewId"

    private companion object {
        private const val PREFS_NAME: String = "crew_projection_meta"
    }
}
