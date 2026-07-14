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
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.achievements.Achievement
import com.pomo.achievements.AchievementStatus
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.ui.theme.PomoRadius
import com.pomo.ui.theme.PomoSpacing
import com.pomo.ui.theme.PomoTokens

/**
 * Your achievements: the whole catalog, earned on top and not-yet-earned below. A ledger, not a
 * trophy shelf — flat and typographic, hairline boxes, nothing raised (ADR 0004-A / 0005). The badge
 * is the number; earned tiles are full ink, unearned are ghosted so the page reads as a ratchet you
 * climb rather than a wall of locks.
 */
@Composable
public fun AchievementsScreen(
    statuses: List<AchievementStatus>,
    onBack: () -> Unit,
) {
    val scroll = rememberScrollState()
    val earned = statuses.filter { it.earned }.map { it.achievement }
    val notEarned = statuses.filterNot { it.earned }.map { it.achievement }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scroll)
            .padding(horizontal = PomoSpacing.Lg, vertical = PomoSpacing.M),
    ) {
        AchievementsHeader(earnedCount = earned.size, total = statuses.size, onBack = onBack)

        if (earned.isNotEmpty()) {
            Spacer(Modifier.height(PomoSpacing.Xl))
            SectionLabel("Earned")
            Spacer(Modifier.height(PomoSpacing.Sm))
            AchievementGrid(earned, earned = true)
        }

        if (notEarned.isNotEmpty()) {
            Spacer(Modifier.height(PomoSpacing.Xl))
            SectionLabel(if (earned.isEmpty()) "Everything to earn" else "Not earned yet")
            Spacer(Modifier.height(PomoSpacing.Sm))
            AchievementGrid(notEarned, earned = false)
        }

        Spacer(Modifier.height(PomoSpacing.Xl))
    }
}

/**
 * A crew member's earned achievements, for their stats page. Earned-only on purpose: their shared
 * snapshot can prove what they reached but never that they *didn't* reach something, so there is no
 * "not earned" section — a dimmed tile would assert something false about a real person (ADR 0005).
 */
@Composable
public fun PeerAchievementsSection(
    displayName: String,
    earned: List<Achievement>,
) {
    if (earned.isEmpty()) return
    Column(modifier = Modifier.fillMaxWidth()) {
        SectionLabel("$displayName has earned")
        Spacer(Modifier.height(PomoSpacing.Sm))
        AchievementGrid(earned, earned = true)
    }
}

/**
 * The Profile teaser: the furthest rung on each ladder, plus how much of the catalog is earned. Taps
 * through to the full page. Reuses the same hairline tile so the Profile and the page speak as one.
 */
@Composable
public fun AchievementHighlightsRow(
    highlights: List<Achievement>,
    earnedCount: Int,
    total: Int,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
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
            Text(
                text = "›",
                style = MaterialTheme.typography.bodyLarge,
                color = PomoTokens.colors.onSurfaceFaint,
            )
        }
        if (highlights.isNotEmpty()) {
            Spacer(Modifier.height(PomoSpacing.Sm))
            Row(horizontalArrangement = Arrangement.spacedBy(PomoSpacing.S)) {
                highlights.forEach { achievement ->
                    AchievementTile(achievement, earned = true, modifier = Modifier.weight(1f))
                }
                // Keep the tiles left-aligned at their real width when fewer than three are earned.
                repeat(HIGHLIGHT_SLOTS - highlights.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun AchievementsHeader(earnedCount: Int, total: Int, onBack: () -> Unit) {
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
            Text(
                text = "Achievements",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = "$earnedCount of $total earned",
                style = MaterialTheme.typography.bodyMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = PomoTokens.colors.onSurfaceFaint,
    )
}

/** A dependency-free two-column grid: the catalog is small, so plain chunked Rows beat a lazy grid. */
@Composable
private fun AchievementGrid(items: List<Achievement>, earned: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(PomoSpacing.S)) {
        items.chunked(GRID_COLUMNS).forEach { rowItems ->
            Row(horizontalArrangement = Arrangement.spacedBy(PomoSpacing.S)) {
                rowItems.forEach { achievement ->
                    AchievementTile(achievement, earned = earned, modifier = Modifier.weight(1f))
                }
                repeat(GRID_COLUMNS - rowItems.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun AchievementTile(
    achievement: Achievement,
    earned: Boolean,
    modifier: Modifier = Modifier,
) {
    val ink = if (earned) MaterialTheme.colorScheme.onSurface else PomoTokens.colors.onSurfaceFaint
    Column(
        modifier = modifier
            .border(1.dp, PomoTokens.colors.outline, RoundedCornerShape(PomoRadius.Md))
            .padding(horizontal = PomoSpacing.Sm, vertical = PomoSpacing.M),
    ) {
        Text(text = achievement.badge, style = badgeTextStyle, color = ink)
        Spacer(Modifier.height(PomoSpacing.S))
        Text(
            text = achievement.title,
            style = MaterialTheme.typography.titleMedium,
            color = ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = achievement.fact,
            style = MaterialTheme.typography.bodySmall,
            color = PomoTokens.colors.onSurfaceFaint,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// Tabular figures, like every other numeric readout in the app (see TimerTextStyle). The badge is
// the number, so the digits must not shift width between "100h" and "500h".
private val badgeTextStyle: TextStyle = TextStyle(
    fontFamily = JetBrainsMono,
    fontWeight = FontWeight.SemiBold,
    fontSize = 26.sp,
    fontFeatureSettings = "tnum",
)

private const val GRID_COLUMNS: Int = 2
private const val HIGHLIGHT_SLOTS: Int = 3
