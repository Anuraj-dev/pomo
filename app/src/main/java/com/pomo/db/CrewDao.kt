package com.pomo.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
public interface CrewDao {
    @Query("SELECT * FROM crew_snapshots WHERE crewId = :crewId ORDER BY publishedAtEpochSeconds DESC")
    public fun observeSnapshots(crewId: String): Flow<List<CrewSnapshotEntity>>

    @Query("SELECT * FROM crew_daily_aggregates WHERE crewId = :crewId ORDER BY localDate DESC")
    public fun observeDailyAggregates(crewId: String): Flow<List<CrewDailyAggregateEntity>>

    @Query("SELECT * FROM crew_hidden_members WHERE crewId = :crewId")
    public fun observeHiddenMembers(crewId: String): Flow<List<CrewHiddenMemberEntity>>

    @Query("SELECT * FROM crew_relay_state WHERE crewId = :crewId ORDER BY relayUrl ASC")
    public fun observeRelayStates(crewId: String): Flow<List<CrewRelayStateEntity>>

    @Query("SELECT * FROM crew_snapshots WHERE crewId = :crewId ORDER BY publishedAtEpochSeconds DESC")
    public suspend fun getSnapshots(crewId: String): List<CrewSnapshotEntity>

    @Query("SELECT * FROM crew_daily_aggregates WHERE crewId = :crewId ORDER BY localDate DESC")
    public suspend fun getDailyAggregates(crewId: String): List<CrewDailyAggregateEntity>

    @Query("SELECT * FROM crew_hidden_members WHERE crewId = :crewId")
    public suspend fun getHiddenMembers(crewId: String): List<CrewHiddenMemberEntity>

    @Query("SELECT * FROM crew_relay_state WHERE crewId = :crewId ORDER BY relayUrl ASC")
    public suspend fun getRelayStates(crewId: String): List<CrewRelayStateEntity>

    @Query("SELECT * FROM crew_relay_state WHERE crewId = :crewId AND relayUrl = :relayUrl LIMIT 1")
    public suspend fun getRelayState(
        crewId: String,
        relayUrl: String,
    ): CrewRelayStateEntity?

    @Query("SELECT * FROM crew_snapshots ORDER BY crewId ASC, identityPublicKey ASC")
    public suspend fun getAllSnapshots(): List<CrewSnapshotEntity>

    @Query("SELECT * FROM crew_daily_aggregates ORDER BY crewId ASC, identityPublicKey ASC, localDate ASC")
    public suspend fun getAllDailyAggregates(): List<CrewDailyAggregateEntity>

    @Query("SELECT * FROM crew_hidden_members ORDER BY crewId ASC, identityPublicKey ASC")
    public suspend fun getAllHiddenMembers(): List<CrewHiddenMemberEntity>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    public suspend fun insertMissingSnapshots(snapshots: List<CrewSnapshotEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    public suspend fun insertMissingDailyAggregates(aggregates: List<CrewDailyAggregateEntity>)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    public suspend fun insertMissingHiddenMembers(hiddenMembers: List<CrewHiddenMemberEntity>)

    /**
     * Fills the projection back in from a backup without disturbing what the device already knows.
     * Rows that exist are left alone — a live snapshot is always at least as fresh as a backed-up
     * one — and snapshots go in ahead of aggregates, which are their foreign-key children.
     */
    @Transaction
    public suspend fun restoreProjection(
        snapshots: List<CrewSnapshotEntity>,
        aggregates: List<CrewDailyAggregateEntity>,
        hiddenMembers: List<CrewHiddenMemberEntity>,
    ) {
        insertMissingSnapshots(snapshots)
        insertMissingDailyAggregates(aggregates)
        insertMissingHiddenMembers(hiddenMembers)
    }

    @Query(
        "SELECT publishedAtEpochSeconds FROM crew_snapshots " +
            "WHERE crewId = :crewId AND identityPublicKey = :identityPublicKey",
    )
    public suspend fun getPublishedAt(
        crewId: String,
        identityPublicKey: String,
    ): Long?

    @Upsert
    public suspend fun upsertSnapshot(snapshot: CrewSnapshotEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    public suspend fun insertDailyAggregates(aggregates: List<CrewDailyAggregateEntity>)

    @Query("DELETE FROM crew_daily_aggregates WHERE crewId = :crewId AND identityPublicKey = :identityPublicKey")
    public suspend fun deleteDailyAggregates(
        crewId: String,
        identityPublicKey: String,
    )

    @Transaction
    public suspend fun upsertLatest(
        snapshot: CrewSnapshotEntity,
        aggregates: List<CrewDailyAggregateEntity>,
    ): Boolean {
        val currentPublishedAt = getPublishedAt(snapshot.crewId, snapshot.identityPublicKey)
        if (currentPublishedAt != null && currentPublishedAt >= snapshot.publishedAtEpochSeconds) return false
        upsertSnapshot(snapshot)
        deleteDailyAggregates(snapshot.crewId, snapshot.identityPublicKey)
        insertDailyAggregates(aggregates)
        return true
    }

    @Upsert
    public suspend fun upsertHiddenMember(hiddenMember: CrewHiddenMemberEntity)

    @Query("DELETE FROM crew_hidden_members WHERE crewId = :crewId AND identityPublicKey = :identityPublicKey")
    public suspend fun unhideMember(
        crewId: String,
        identityPublicKey: String,
    )

    @Upsert
    public suspend fun upsertRelayState(relayState: CrewRelayStateEntity)

    @Query("DELETE FROM crew_snapshots WHERE crewId = :crewId")
    public suspend fun deleteCrewSnapshots(crewId: String)

    @Query("DELETE FROM crew_relay_state WHERE crewId = :crewId")
    public suspend fun deleteCrewRelayStates(crewId: String)

    @Query("DELETE FROM crew_hidden_members WHERE crewId = :crewId")
    public suspend fun deleteCrewHiddenMembers(crewId: String)

    @Transaction
    public suspend fun deleteCrewProjection(crewId: String) {
        deleteCrewSnapshots(crewId)
        deleteCrewRelayStates(crewId)
        deleteCrewHiddenMembers(crewId)
    }
}
