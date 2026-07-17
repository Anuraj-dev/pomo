package com.pomo.backup

/**
 * The on-disk backup format. These types are deliberately separate from the Room entities and the
 * crew wire models: the file is handed to the user and must keep parsing after a schema change, so
 * it owns its own shape. Every field carries a default so an older file still decodes.
 */
public data class PomoBackup(
    val format: String = FORMAT,
    val version: Int = VERSION,
    val exportedAtEpochSeconds: Long = 0L,
    val appVersionName: String = "",
    val history: BackupHistory = BackupHistory(),
    val crew: BackupCrew = BackupCrew(),
) {
    public companion object {
        public const val FORMAT: String = "pomo-backup"
        public const val VERSION: Int = 1
    }
}

public data class BackupHistory(
    val dayStats: List<BackupDayStats> = emptyList(),
    val sessions: List<BackupSession> = emptyList(),
)

public data class BackupDayStats(
    val date: String = "",
    val completed: Int = 0,
    val workMinutes: Int = 0,
    val breakMinutes: Int = 0,
)

public data class BackupSession(
    val start: Long = 0L,
    val date: String = "",
    val type: String = "",
    val duration: Int = 0,
    val completed: Boolean = false,
    val tag: String? = null,
)

/**
 * The crew half of a backup. [identityPrivateKey] and [memberships] are the only parts that cannot
 * be rebuilt from anywhere else — lose them and the crews are gone. The projection tables travel
 * too so a restored device shows a populated board before the first relay refresh lands; the relay
 * state table does not, being nothing but attempt timestamps and error strings.
 */
public data class BackupCrew(
    val identityPrivateKey: String = "",
    val profileAvatarBase64: String? = null,
    val activeCrewId: String? = null,
    val memberships: List<BackupMembership> = emptyList(),
    val snapshots: List<BackupSnapshot> = emptyList(),
    val dailyAggregates: List<BackupDailyAggregate> = emptyList(),
    val hiddenMembers: List<BackupHiddenMember> = emptyList(),
)

public data class BackupMembership(
    val crewId: String = "",
    val crewName: String = "",
    val joinCode: String = "",
    val relays: List<String> = emptyList(),
    val key: String = "",
    val displayName: String = "",
    val protocolVersion: Int = 0,
)

public data class BackupSnapshot(
    val crewId: String = "",
    val identityPublicKey: String = "",
    val displayName: String = "",
    val avatarBase64: String? = null,
    val allTimeFocusMinutes: Int = 0,
    val publishedAtEpochSeconds: Long = 0L,
    val localDate: String = "",
    val utcOffsetMinutes: Int = 0,
    val currentStreak: Int = 0,
    val lastFocusedAtEpochSeconds: Long = 0L,
    val protocolVersion: Int = 0,
    val statsJson: String? = null,
)

public data class BackupDailyAggregate(
    val crewId: String = "",
    val identityPublicKey: String = "",
    val localDate: String = "",
    val focusMinutes: Int = 0,
    val completedWorkBlocks: Int = 0,
)

public data class BackupHiddenMember(
    val crewId: String = "",
    val identityPublicKey: String = "",
    val hiddenAtEpochSeconds: Long = 0L,
)

/** What a restore actually put back, for the confirmation the user sees afterwards. */
public data class BackupRestoreSummary(
    val sessionsAdded: Int,
    val daysAffected: Int,
    val membershipsAdded: Int,
    val identityRestored: Boolean,
)
