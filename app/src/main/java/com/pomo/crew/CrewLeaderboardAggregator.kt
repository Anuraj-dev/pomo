package com.pomo.crew

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

public object CrewLeaderboardAggregator {
    public fun rank(
        crewId: String,
        snapshots: List<CrewSnapshot>,
        selfIdentityPublicKey: String,
        mode: CrewRankingMode = CrewRankingMode.AllTime,
        nowEpochSeconds: Long = System.currentTimeMillis() / 1000L,
    ): List<CrewBoardRow> {
        val latestSnapshots = snapshots.asSequence()
            .filter { it.crewId == crewId && CrewValidation.isValidSnapshot(it) }
            .groupBy { it.identityPublicKey }
            .values
            .mapNotNull { identitySnapshots -> identitySnapshots.maxByOrNull { it.publishedAtEpochSeconds } }

        val candidates = latestSnapshots.map { snapshot ->
            val today = localDateAt(snapshot.utcOffsetMinutes, nowEpochSeconds)
            val todayAggregate = snapshot.dailyAggregates.firstOrNull { it.localDate == today.toString() }
            val sevenDayMinutes = snapshot.sumFocusMinutes(today.minusDays(6), today)
            val thirtyDayMinutes = snapshot.sumFocusMinutes(today.minusDays(29), today)
            val selectedMinutes = when (mode) {
                CrewRankingMode.Today -> todayAggregate?.focusMinutes ?: 0
                CrewRankingMode.Yesterday -> snapshot.focusMinutesOn(today.minusDays(1).toString())
                CrewRankingMode.SevenDays -> sevenDayMinutes
                CrewRankingMode.ThirtyDays -> thirtyDayMinutes
                CrewRankingMode.AllTime -> snapshot.allTimeFocusMinutes
                is CrewRankingMode.Day -> snapshot.focusMinutesOn(mode.localDate)
            }
            RankedSnapshot(
                snapshot = snapshot,
                selectedMinutes = selectedMinutes,
                todayMinutes = todayAggregate?.focusMinutes ?: 0,
                todayWorkBlocks = todayAggregate?.completedWorkBlocks ?: 0,
                sevenDayMinutes = sevenDayMinutes,
                thirtyDayMinutes = thirtyDayMinutes,
                isStale = snapshot.isStale(nowEpochSeconds),
                isInactive = snapshot.isInactive(nowEpochSeconds),
            )
        }.sortedWith(
            compareBy<RankedSnapshot> { it.isInactive }
                .thenBy { it.selectedMinutes == 0 }
                .thenByDescending { it.selectedMinutes }
                .thenBy { it.snapshot.displayName.lowercase() }
                .thenBy { it.snapshot.identityPublicKey },
        )

        var previousMinutes: Int? = null
        var previousRank: Int? = null
        var activePosition = 0
        return candidates.map { candidate ->
            val rank = when {
                candidate.isInactive || candidate.selectedMinutes == 0 -> null
                else -> {
                    activePosition += 1
                    if (candidate.selectedMinutes == previousMinutes) {
                        previousRank
                    } else {
                        activePosition.also {
                            previousMinutes = candidate.selectedMinutes
                            previousRank = it
                        }
                    }
                }
            }
            candidate.toBoardRow(rank, selfIdentityPublicKey)
        }
    }

    private fun RankedSnapshot.toBoardRow(rank: Int?, selfIdentityPublicKey: String): CrewBoardRow =
        CrewBoardRow(
            rank = rank,
            identityPublicKey = snapshot.identityPublicKey,
            displayName = snapshot.displayName,
            allTimeFocusMinutes = snapshot.allTimeFocusMinutes,
            todayFocusMinutes = todayMinutes,
            sevenDayFocusMinutes = sevenDayMinutes,
            thirtyDayFocusMinutes = thirtyDayMinutes,
            selectedFocusMinutes = selectedMinutes,
            currentStreak = snapshot.currentStreak,
            todaySessionCount = todayWorkBlocks,
            lastFocusedAtEpochSeconds = snapshot.lastFocusedAtEpochSeconds,
            dailyAggregates = snapshot.dailyAggregates,
            isSelf = snapshot.identityPublicKey == selfIdentityPublicKey,
            isStale = isStale,
            isInactive = isInactive,
            localDate = snapshot.localDate,
            stats = snapshot.stats,
            presence = snapshot.presence,
        )

    private fun CrewSnapshot.focusMinutesOn(localDate: String): Int =
        dailyAggregates.firstOrNull { it.localDate == localDate }?.focusMinutes ?: 0

    private fun CrewSnapshot.sumFocusMinutes(startDate: LocalDate, endDate: LocalDate): Int =
        dailyAggregates.sumOf { aggregate ->
            val date = LocalDate.parse(aggregate.localDate)
            if (date < startDate || date > endDate) 0 else aggregate.focusMinutes
        }

    private fun CrewSnapshot.isStale(nowEpochSeconds: Long): Boolean =
        lastFocusedAtEpochSeconds > 0L && nowEpochSeconds - lastFocusedAtEpochSeconds >= STALE_AFTER_SECONDS

    private fun CrewSnapshot.isInactive(nowEpochSeconds: Long): Boolean =
        lastFocusedAtEpochSeconds > 0L && nowEpochSeconds - lastFocusedAtEpochSeconds >= INACTIVE_AFTER_SECONDS

    private fun localDateAt(utcOffsetMinutes: Int, epochSeconds: Long): LocalDate =
        Instant.ofEpochSecond(epochSeconds)
            .atOffset(ZoneOffset.ofTotalSeconds(utcOffsetMinutes * 60))
            .toLocalDate()

    private data class RankedSnapshot(
        val snapshot: CrewSnapshot,
        val selectedMinutes: Int,
        val todayMinutes: Int,
        val todayWorkBlocks: Int,
        val sevenDayMinutes: Int,
        val thirtyDayMinutes: Int,
        val isStale: Boolean,
        val isInactive: Boolean,
    )

    private const val STALE_AFTER_SECONDS: Long = 7L * 24L * 60L * 60L
    private const val INACTIVE_AFTER_SECONDS: Long = 30L * 24L * 60L * 60L
}
