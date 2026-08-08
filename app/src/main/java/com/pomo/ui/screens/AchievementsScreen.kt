package com.pomo.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.achievements.Achievement
import com.pomo.achievements.AchievementAxis
import com.pomo.achievements.AchievementStatus
import com.pomo.stats.StatsSnapshot
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.ui.theme.PomoRadius
import com.pomo.ui.theme.PomoSpacing
import com.pomo.ui.theme.PomoTokens
import java.util.Locale

/** The complete personal record ledger, grouped into comparable tracks rather than earned state. */
@Composable
public fun AchievementsScreen(
    snapshot: StatsSnapshot,
    statuses: List<AchievementStatus>,
    onBack: () -> Unit,
) {
    val earnedCount = statuses.count { it.earned }
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = PomoSpacing.Lg, vertical = PomoSpacing.M),
    ) {
        AchievementsHeader(earnedCount = earnedCount, total = statuses.size, onBack = onBack)
        Spacer(Modifier.height(PomoSpacing.Xl))

        val entry = statuses.single { it.achievement.axis == AchievementAxis.Milestone }
        EntryRecord(entry)

        TrackPanel("Focus volume", AchievementAxis.Focus, snapshot, statuses)
        TrackPanel("Active days", AchievementAxis.ActiveDays, snapshot, statuses)
        TrackPanel("Longest streak", AchievementAxis.Streak, snapshot, statuses)
        TrackPanel("Best day", AchievementAxis.BestDay, snapshot, statuses)
        Spacer(Modifier.height(PomoSpacing.Xl))
    }
}

/** A peer exposes only the highest record that their shared aggregate can prove in each track. */
@Composable
public fun PeerAchievementsSection(
    displayName: String,
    earned: List<Achievement>,
) {
    if (earned.isEmpty()) return
    Column(modifier = Modifier.fillMaxWidth()) {
        SectionLabel("$displayName's records")
        Spacer(Modifier.height(PomoSpacing.Sm))
        CompactRecordGrid(earned)
    }
}

/** Profile summary: one highest earned record per track, with Entry as the fresh-member fallback. */
@Composable
public fun AchievementHighlightsRow(
    highlights: List<Achievement>,
    earnedCount: Int,
    total: Int,
    onClick: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(vertical = PomoSpacing.M),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "Achievements",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "$earnedCount / $total",
                style = MaterialTheme.typography.labelMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
            Spacer(Modifier.width(PomoSpacing.S))
            Text("›", style = MaterialTheme.typography.bodyLarge, color = PomoTokens.colors.onSurfaceFaint)
        }
        if (highlights.isNotEmpty()) {
            Spacer(Modifier.height(PomoSpacing.Sm))
            CompactRecordGrid(highlights)
        }
    }
}

@Composable
private fun TrackPanel(
    title: String,
    axis: AchievementAxis,
    snapshot: StatsSnapshot,
    allStatuses: List<AchievementStatus>,
) {
    val statuses = allStatuses.filter { it.achievement.axis == axis }
    val record = statuses.lastOrNull { it.earned }?.achievement
    val next = statuses.firstOrNull { !it.earned }?.achievement
    val columns = if (LocalConfiguration.current.fontScale >= LARGE_FONT_SCALE) 1 else DEFAULT_COLUMNS
    Spacer(Modifier.height(PomoSpacing.Xl))
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(1.dp, PomoTokens.colors.outline, RoundedCornerShape(PomoRadius.Md))
                .padding(PomoSpacing.M),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            SectionLabel(title)
            Spacer(Modifier.weight(1f))
            Text(
                text = trackReading(axis, snapshot),
                style = readingTextStyle,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
        Spacer(Modifier.height(PomoSpacing.S))
        Text(
            text = trackEdge(axis, snapshot, next),
            style = MaterialTheme.typography.bodySmall,
            color = if (next == null) PomoTokens.colors.onSurfaceMuted else MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(PomoSpacing.M))
        Column(verticalArrangement = Arrangement.spacedBy(PomoSpacing.S)) {
            statuses.chunked(columns).forEach { rowItems ->
                Row(horizontalArrangement = Arrangement.spacedBy(PomoSpacing.S)) {
                    rowItems.forEach { status ->
                        val state =
                            when (status.achievement) {
                                record -> RungState.Record
                                next -> RungState.Next
                                else -> if (status.earned) RungState.Earned else RungState.Future
                            }
                        AchievementRung(status.achievement, state, Modifier.weight(1f))
                    }
                    repeat(columns - rowItems.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun EntryRecord(status: AchievementStatus) {
    val achievement = status.achievement
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .border(1.dp, PomoTokens.colors.outline, RoundedCornerShape(PomoRadius.Md))
                .padding(PomoSpacing.M),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            SectionLabel("Entry")
            Spacer(Modifier.height(PomoSpacing.Xs))
            Text(achievement.title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface)
            Text(achievement.fact, style = MaterialTheme.typography.bodySmall, color = PomoTokens.colors.onSurfaceMuted)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = achievement.badge,
                style = badgeTextStyle,
                color = if (status.earned) MaterialTheme.colorScheme.onSurface else PomoTokens.colors.onSurfaceFaint,
            )
            StateLabel(if (status.earned) "RECORDED" else "PENDING", status.earned)
        }
    }
}

private enum class RungState { Earned, Record, Next, Future }

@Composable
private fun AchievementRung(
    achievement: Achievement,
    state: RungState,
    modifier: Modifier,
) {
    val ink =
        when (state) {
            RungState.Next -> MaterialTheme.colorScheme.primary
            RungState.Earned, RungState.Record -> MaterialTheme.colorScheme.onSurface
            RungState.Future -> PomoTokens.colors.onSurfaceFaint
        }
    Column(
        modifier =
            modifier
                .background(PomoTokens.colors.surfaceElevated, RoundedCornerShape(PomoRadius.Sm))
                .padding(PomoSpacing.Sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(achievement.badge, style = rungBadgeTextStyle, color = ink, modifier = Modifier.weight(1f))
            when (state) {
                RungState.Record -> StateLabel("RECORD", true)
                RungState.Next -> StateLabel("NEXT", true, accent = true)
                else -> Unit
            }
        }
        Spacer(Modifier.height(PomoSpacing.Xs))
        Text(achievement.title, style = MaterialTheme.typography.bodyMedium, color = ink)
        Text(achievement.fact, style = MaterialTheme.typography.labelSmall, color = PomoTokens.colors.onSurfaceFaint)
    }
}

@Composable
private fun CompactRecordGrid(records: List<Achievement>) {
    val columns = if (LocalConfiguration.current.fontScale >= LARGE_FONT_SCALE) 1 else DEFAULT_COLUMNS
    Column(verticalArrangement = Arrangement.spacedBy(PomoSpacing.S)) {
        records.chunked(columns).forEach { rowRecords ->
            Row(horizontalArrangement = Arrangement.spacedBy(PomoSpacing.S)) {
                rowRecords.forEach { achievement ->
                    Row(
                        modifier =
                            Modifier
                                .weight(1f)
                                .background(PomoTokens.colors.surfaceElevated, RoundedCornerShape(PomoRadius.Sm))
                                .padding(PomoSpacing.Sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(achievement.badge, style = compactBadgeTextStyle, color = MaterialTheme.colorScheme.onSurface)
                        Spacer(Modifier.width(PomoSpacing.S))
                        Column {
                            SectionLabel(achievement.axis.trackLabel())
                            Text(achievement.title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
                repeat(columns - rowRecords.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun StateLabel(
    text: String,
    active: Boolean,
    accent: Boolean = false,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color =
            when {
                accent -> MaterialTheme.colorScheme.primary
                active -> PomoTokens.colors.onSurfaceMuted
                else -> PomoTokens.colors.onSurfaceFaint
            },
    )
}

@Composable
private fun AchievementsHeader(
    earnedCount: Int,
    total: Int,
    onBack: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back to profile",
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp),
            )
        }
        Spacer(Modifier.width(PomoSpacing.Xs))
        Column(modifier = Modifier.weight(1f)) {
            Text("Achievements", style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.onSurface)
            Text("$earnedCount of $total recorded", style = MaterialTheme.typography.bodyMedium, color = PomoTokens.colors.onSurfaceMuted)
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text.uppercase(Locale.ROOT), style = MaterialTheme.typography.labelSmall, color = PomoTokens.colors.onSurfaceFaint)
}

private fun trackReading(
    axis: AchievementAxis,
    snapshot: StatsSnapshot,
): String =
    when (axis) {
        AchievementAxis.Focus -> formatAchievementMinutes(snapshot.lifetime.focusMinutes)
        AchievementAxis.ActiveDays -> "${snapshot.lifetime.activeDays}d"
        AchievementAxis.Streak -> "BEST ${snapshot.records.longestStreak}d"
        AchievementAxis.BestDay -> "BEST ${formatAchievementMinutes(snapshot.records.bestDay?.minutes ?: 0)}"
        AchievementAxis.Milestone -> ""
    }

private fun trackEdge(
    axis: AchievementAxis,
    snapshot: StatsSnapshot,
    next: Achievement?,
): String {
    if (next == null) return "MAX RECORDED"
    return when (axis) {
        AchievementAxis.Focus -> "${formatAchievementMinutes(snapshot.lifetime.focusMinutes)} / ${next.badge}"
        AchievementAxis.ActiveDays -> "${snapshot.lifetime.activeDays} / ${next.badge}"
        AchievementAxis.Streak -> "CURRENT ${snapshot.habit.currentStreak}d · NEXT RECORD ${next.badge}"
        AchievementAxis.BestDay -> "NEXT RECORD ${next.badge}"
        AchievementAxis.Milestone -> ""
    }
}

private fun formatAchievementMinutes(minutes: Int): String {
    val hours = minutes / 60
    val remainder = minutes % 60
    return when {
        remainder == 0 -> "${hours}h"
        hours == 0 -> "${remainder}m"
        else -> "${hours}h ${remainder}m"
    }
}

private fun AchievementAxis.trackLabel(): String =
    when (this) {
        AchievementAxis.Focus -> "Focus"
        AchievementAxis.ActiveDays -> "Active"
        AchievementAxis.Streak -> "Streak"
        AchievementAxis.BestDay -> "Best day"
        AchievementAxis.Milestone -> "Entry"
    }

private val badgeTextStyle: TextStyle =
    TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, fontFeatureSettings = "tnum")

private val rungBadgeTextStyle: TextStyle =
    TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, fontFeatureSettings = "tnum")

private val compactBadgeTextStyle: TextStyle =
    TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, fontFeatureSettings = "tnum")

private val readingTextStyle: TextStyle =
    TextStyle(fontFamily = JetBrainsMono, fontWeight = FontWeight.Medium, fontSize = 14.sp, fontFeatureSettings = "tnum")

private const val DEFAULT_COLUMNS: Int = 2
private const val LARGE_FONT_SCALE: Float = 1.5f
