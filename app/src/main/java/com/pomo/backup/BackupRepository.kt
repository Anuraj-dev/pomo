package com.pomo.backup

import android.content.Context
import android.net.Uri
import com.pomo.BuildConfig
import com.pomo.crew.CrewIdentityStore
import com.pomo.crew.CrewMembership
import com.pomo.crew.CrewStore
import com.pomo.db.AppDatabase
import com.pomo.db.CrewDailyAggregateEntity
import com.pomo.db.CrewHiddenMemberEntity
import com.pomo.db.CrewSnapshotEntity
import com.pomo.profile.AvatarStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Writes every piece of local state the user cannot get back any other way into one plain JSON file
 * they own, and folds such a file back in after a reinstall.
 */
public class BackupRepository(context: Context) {
    private val appContext: Context = context.applicationContext
    private val database: AppDatabase = AppDatabase.getInstance(appContext)
    private val historyDao = database.historyDao()
    private val crewDao = database.crewDao()
    private val crewStore = CrewStore(appContext)
    private val identityStore = CrewIdentityStore(appContext)
    private val avatarStore = AvatarStore(appContext)

    public suspend fun export(): PomoBackup =
        withContext(Dispatchers.IO) {
            val memberships = crewStore.loadMemberships()
            PomoBackup(
                exportedAtEpochSeconds = System.currentTimeMillis() / 1000L,
                appVersionName = BuildConfig.VERSION_NAME,
                history =
                    BackupHistory(
                        dayStats =
                            historyDao.getAllDayStatsSnapshot().map { day ->
                                BackupDayStats(
                                    date = day.date,
                                    completed = day.completed,
                                    workMinutes = day.workMinutes,
                                    breakMinutes = day.breakMinutes,
                                )
                            },
                        sessions =
                            historyDao.getAllSessionsSnapshot().map { session ->
                                BackupSession(
                                    start = session.start,
                                    date = session.date,
                                    type = session.type,
                                    duration = session.duration,
                                    completed = session.completed,
                                    tag = session.tag,
                                )
                            },
                    ),
                crew =
                    BackupCrew(
                        // Reading the identity mints one on a device that has never had it. Only ask for it
                        // when there is a crew it could belong to, so exporting stays free of side effects.
                        identityPrivateKey = if (memberships.isEmpty()) "" else identityStore.identity().privateKey,
                        profileAvatarBase64 = avatarStore.encoded(),
                        activeCrewId = crewStore.activeCrewId(),
                        memberships =
                            memberships.map { membership ->
                                BackupMembership(
                                    crewId = membership.crewId,
                                    crewName = membership.crewName,
                                    joinCode = membership.joinCode,
                                    relays = membership.relays,
                                    key = membership.key,
                                    displayName = membership.displayName,
                                    protocolVersion = membership.protocolVersion,
                                )
                            },
                        snapshots =
                            crewDao.getAllSnapshots().map { snapshot ->
                                BackupSnapshot(
                                    crewId = snapshot.crewId,
                                    identityPublicKey = snapshot.identityPublicKey,
                                    displayName = snapshot.displayName,
                                    avatarBase64 = snapshot.avatarBase64,
                                    allTimeFocusMinutes = snapshot.allTimeFocusMinutes,
                                    publishedAtEpochSeconds = snapshot.publishedAtEpochSeconds,
                                    localDate = snapshot.localDate,
                                    utcOffsetMinutes = snapshot.utcOffsetMinutes,
                                    currentStreak = snapshot.currentStreak,
                                    lastFocusedAtEpochSeconds = snapshot.lastFocusedAtEpochSeconds,
                                    protocolVersion = snapshot.protocolVersion,
                                    statsJson = snapshot.statsJson,
                                )
                            },
                        dailyAggregates =
                            crewDao.getAllDailyAggregates().map { aggregate ->
                                BackupDailyAggregate(
                                    crewId = aggregate.crewId,
                                    identityPublicKey = aggregate.identityPublicKey,
                                    localDate = aggregate.localDate,
                                    focusMinutes = aggregate.focusMinutes,
                                    completedWorkBlocks = aggregate.completedWorkBlocks,
                                )
                            },
                        hiddenMembers =
                            crewDao.getAllHiddenMembers().map { hidden ->
                                BackupHiddenMember(
                                    crewId = hidden.crewId,
                                    identityPublicKey = hidden.identityPublicKey,
                                    hiddenAtEpochSeconds = hidden.hiddenAtEpochSeconds,
                                )
                            },
                    ),
            )
        }

    public suspend fun writeTo(uri: Uri): Boolean =
        withContext(Dispatchers.IO) {
            val json = BackupCodec.encode(export())
            BackupFileWriter.write(
                openOutputStream = { mode -> appContext.contentResolver.openOutputStream(uri, mode) },
                json = json,
            )
        }

    public suspend fun readFrom(uri: Uri): PomoBackup? =
        withContext(Dispatchers.IO) {
            runCatching {
                appContext.contentResolver.openInputStream(uri)?.use { stream ->
                    BackupCodec.decode(stream.readBytes().toString(Charsets.UTF_8))
                }
            }.getOrNull()
        }

    public suspend fun restore(backup: PomoBackup): BackupRestoreSummary =
        withContext(Dispatchers.IO) {
            val merged =
                BackupMerge.merge(
                    existingDayStats = historyDao.getAllDayStatsSnapshot(),
                    existingSessions = historyDao.getAllSessionsSnapshot(),
                    backup = backup.history,
                )
            historyDao.replaceAllHistory(merged.dayStats, merged.sessions)

            // The identity is only taken back when this device is in no crews — the reinstall case it
            // exists for. Swapping the key out from under a device that is actively publishing would
            // orphan everything it has already put on its crews' boards under the old public key.
            val hadMemberships = crewStore.loadMemberships().isNotEmpty()
            val identityRestored = backup.crew.identityPrivateKey.isNotBlank() && !hadMemberships
            if (identityRestored) {
                identityStore.replaceIdentity(backup.crew.identityPrivateKey)
            }
            if (!hadMemberships) avatarStore.restore(backup.crew.profileAvatarBase64)

            val membershipsAdded =
                crewStore.mergeMemberships(
                    memberships =
                        backup.crew.memberships.map { membership ->
                            CrewMembership(
                                crewId = membership.crewId,
                                crewName = membership.crewName,
                                joinCode = membership.joinCode,
                                relays = membership.relays,
                                key = membership.key,
                                displayName = membership.displayName,
                                protocolVersion = membership.protocolVersion,
                            )
                        },
                    preferredActiveCrewId = backup.crew.activeCrewId,
                )

            crewDao.restoreProjection(
                snapshots =
                    backup.crew.snapshots.map { snapshot ->
                        CrewSnapshotEntity(
                            crewId = snapshot.crewId,
                            identityPublicKey = snapshot.identityPublicKey,
                            displayName = snapshot.displayName,
                            avatarBase64 = snapshot.avatarBase64,
                            allTimeFocusMinutes = snapshot.allTimeFocusMinutes,
                            publishedAtEpochSeconds = snapshot.publishedAtEpochSeconds,
                            localDate = snapshot.localDate,
                            utcOffsetMinutes = snapshot.utcOffsetMinutes,
                            currentStreak = snapshot.currentStreak,
                            lastFocusedAtEpochSeconds = snapshot.lastFocusedAtEpochSeconds,
                            protocolVersion = snapshot.protocolVersion,
                            statsJson = snapshot.statsJson,
                        )
                    },
                aggregates =
                    backup.crew.dailyAggregates.map { aggregate ->
                        CrewDailyAggregateEntity(
                            crewId = aggregate.crewId,
                            identityPublicKey = aggregate.identityPublicKey,
                            localDate = aggregate.localDate,
                            focusMinutes = aggregate.focusMinutes,
                            completedWorkBlocks = aggregate.completedWorkBlocks,
                        )
                    },
                hiddenMembers =
                    backup.crew.hiddenMembers.map { hidden ->
                        CrewHiddenMemberEntity(
                            crewId = hidden.crewId,
                            identityPublicKey = hidden.identityPublicKey,
                            hiddenAtEpochSeconds = hidden.hiddenAtEpochSeconds,
                        )
                    },
            )

            BackupRestoreSummary(
                sessionsAdded = merged.sessionsAdded,
                daysAffected = merged.daysAffected,
                membershipsAdded = membershipsAdded,
                identityRestored = identityRestored,
            )
        }

    public companion object {
        public const val MIME_TYPE: String = "application/json"

        public fun suggestedFileName(date: String): String = "pomo-backup-$date.json"
    }
}
