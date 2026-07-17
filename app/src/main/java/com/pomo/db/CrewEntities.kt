package com.pomo.db

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

@Entity(
    tableName = "crew_snapshots",
    primaryKeys = ["crewId", "identityPublicKey"],
    indices = [
        Index(value = ["crewId"]),
        Index(value = ["crewId", "publishedAtEpochSeconds"]),
    ],
)
public data class CrewSnapshotEntity(
    val crewId: String,
    val identityPublicKey: String,
    val displayName: String,
    val avatarBase64: String? = null,
    val allTimeFocusMinutes: Int,
    val publishedAtEpochSeconds: Long,
    val localDate: String,
    val utcOffsetMinutes: Int,
    val currentStreak: Int,
    val lastFocusedAtEpochSeconds: Long,
    val protocolVersion: Int,
    val statsJson: String? = null,
)

@Entity(
    tableName = "crew_daily_aggregates",
    primaryKeys = ["crewId", "identityPublicKey", "localDate"],
    foreignKeys = [
        ForeignKey(
            entity = CrewSnapshotEntity::class,
            parentColumns = ["crewId", "identityPublicKey"],
            childColumns = ["crewId", "identityPublicKey"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["crewId", "identityPublicKey"]),
        Index(value = ["crewId", "localDate"]),
    ],
)
public data class CrewDailyAggregateEntity(
    val crewId: String,
    val identityPublicKey: String,
    val localDate: String,
    val focusMinutes: Int,
    val completedWorkBlocks: Int,
)

@Entity(
    tableName = "crew_hidden_members",
    primaryKeys = ["crewId", "identityPublicKey"],
    indices = [Index(value = ["crewId"])],
)
public data class CrewHiddenMemberEntity(
    val crewId: String,
    val identityPublicKey: String,
    val hiddenAtEpochSeconds: Long,
)

@Entity(
    tableName = "crew_relay_state",
    primaryKeys = ["crewId", "relayUrl"],
    indices = [Index(value = ["crewId"])],
)
public data class CrewRelayStateEntity(
    val crewId: String,
    val relayUrl: String,
    val lastAttemptEpochSeconds: Long,
    val lastSuccessEpochSeconds: Long?,
    val lastError: String?,
)
