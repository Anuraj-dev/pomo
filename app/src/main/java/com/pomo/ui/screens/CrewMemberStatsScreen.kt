package com.pomo.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.patrykandpatrick.vico.compose.axis.horizontal.rememberBottomAxis
import com.patrykandpatrick.vico.compose.axis.vertical.rememberStartAxis
import com.patrykandpatrick.vico.compose.chart.Chart
import com.patrykandpatrick.vico.compose.chart.line.lineChart
import com.patrykandpatrick.vico.compose.chart.line.lineSpec
import com.patrykandpatrick.vico.compose.component.shape.shader.verticalGradient
import com.patrykandpatrick.vico.core.axis.AxisItemPlacer
import com.patrykandpatrick.vico.core.axis.AxisPosition
import com.patrykandpatrick.vico.core.axis.formatter.AxisValueFormatter
import com.patrykandpatrick.vico.core.chart.values.AxisValuesOverrider
import com.patrykandpatrick.vico.core.chart.values.ChartValues
import com.patrykandpatrick.vico.core.entry.ChartEntryModelProducer
import com.patrykandpatrick.vico.core.entry.FloatEntry
import com.pomo.crew.CrewBoardRow
import com.pomo.crew.CrewValidation
import com.pomo.stats.TrendPoint
import com.pomo.ui.components.SectionHeader
import com.pomo.ui.components.SegmentedToggle
import com.pomo.ui.components.SegmentedToggleOption
import com.pomo.ui.components.StatTile
import com.pomo.ui.theme.PomoTokens
import com.pomo.ui.theme.TimerTextStyle
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * A crew member's own stats page, built purely from the daily totals their snapshot carries.
 * Deliberately mirrors [StatsScreen]'s vocabulary, but every surface names the member so a
 * screenshot of this page can never be mistaken for the viewer's own numbers.
 */
@Composable
internal fun CrewMemberStatsScreen(
    row: CrewBoardRow,
    onBack: () -> Unit,
) {
    val today = remember { LocalDate.now() }
    val history = remember(row.dailyAggregates, today) { row.trendPoints(HISTORY_DAYS, today) }
    val hasHistory = history.any { it.value > 0f }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(bottom = 32.dp),
    ) {
        MemberStatsHeader(row = row, onBack = onBack)

        if (hasHistory) {
            Spacer(Modifier.height(24.dp))
            SectionHeader("Trend")
            Spacer(Modifier.height(12.dp))
            MemberTrendChart(history = history)

            Spacer(Modifier.height(28.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                StatTile(value = formatMinutes(row.todayFocusMinutes), label = "Today")
                StatTile(value = formatMinutes(row.sevenDayFocusMinutes), label = "7 day")
                StatTile(value = formatMinutes(row.thirtyDayFocusMinutes), label = "30 day")
            }
        } else {
            Spacer(Modifier.height(24.dp))
            Text(
                text = "No focus recorded in the last $HISTORY_DAYS days.",
                style = MaterialTheme.typography.bodyMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
        }

        Spacer(Modifier.height(28.dp))
        SectionHeader("All time")
        Spacer(Modifier.height(8.dp))
        Text(
            text = formatMinutes(row.allTimeFocusMinutes),
            style = TimerTextStyle.copy(fontSize = 48.sp),
            color = PomoTokens.colors.onSurface,
        )
        Spacer(Modifier.height(6.dp))
        Text(
            text = allTimeCaption(row, history),
            style = MaterialTheme.typography.bodySmall,
            color = PomoTokens.colors.onSurfaceMuted,
        )

        Spacer(Modifier.height(28.dp))
        Text(
            text = "Crew members share daily totals only, so this page goes back " +
                "$HISTORY_DAYS days and cannot show their hour-by-hour rhythm.",
            style = MaterialTheme.typography.labelSmall,
            color = PomoTokens.colors.onSurfaceFaint,
        )
    }
}

@Composable
private fun MemberStatsHeader(row: CrewBoardRow, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back to crew",
                tint = PomoTokens.colors.onSurfaceMuted,
                modifier = Modifier.size(20.dp),
            )
        }
        Spacer(Modifier.width(4.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "${row.displayName}'s stats",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
                color = PomoTokens.colors.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(6.dp))
            OwnerChip(row = row)
        }
    }
}

/** Names who these numbers belong to, so a shared screenshot is never ambiguous. */
@Composable
private fun OwnerChip(row: CrewBoardRow) {
    val accent = PomoTokens.colors.accent
    val label = if (row.isSelf) {
        "You · ${row.identityPublicKey.takeLast(FINGERPRINT_CHARS).uppercase()}"
    } else {
        "Crew member · not you · ${row.identityPublicKey.takeLast(FINGERPRINT_CHARS).uppercase()}"
    }
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(accent.copy(alpha = 0.14f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        style = MaterialTheme.typography.labelSmall,
        fontFamily = FontFamily.Monospace,
        color = accent,
    )
}

@Composable
private fun MemberTrendChart(history: List<TrendPoint>) {
    var days by remember { mutableStateOf(TREND_SEVEN) }
    val points = remember(history, days) { history.takeLast(days.toInt()) }

    val accent = PomoTokens.colors.accent
    val muted = PomoTokens.colors.onSurfaceMuted
    val modelProducer = remember { ChartEntryModelProducer() }
    var chartReady by remember(points) { mutableStateOf(false) }

    LaunchedEffect(points) {
        chartReady = false
        modelProducer.setEntries(points.mapIndexed { i, p -> FloatEntry(i.toFloat(), p.value) })
        chartReady = true
    }

    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        SegmentedToggle(
            options = listOf(
                SegmentedToggleOption(TREND_SEVEN, "7 day"),
                SegmentedToggleOption(TREND_THIRTY, "30 day"),
            ),
            selectedValue = days,
            onSelectedValueChange = { days = it },
        )
    }
    Spacer(Modifier.height(10.dp))

    val areaShader = verticalGradient(arrayOf(accent.copy(alpha = 0.25f), Color.Transparent))
    val spec = lineSpec(lineColor = accent, lineThickness = 2.dp, lineBackgroundShader = areaShader)

    val labels = points.map { it.label }
    val labelFormatter = remember(labels) {
        object : AxisValueFormatter<AxisPosition.Horizontal.Bottom> {
            override fun formatValue(value: Float, chartValues: ChartValues): CharSequence =
                labels.getOrElse(value.toInt()) { "" }
        }
    }

    // Entry values are minutes; the Y axis reads in whole hours on a "nice" scale, matching Stats.
    val maxMinutes = points.maxOfOrNull { it.value } ?: 0f
    val stepHours = crewNiceHourStep(maxMinutes / 60f)
    val steps = ceil((maxMinutes / 60f) / stepHours).toInt().coerceAtLeast(1)
    val niceMaxMinutes = (steps * stepHours * 60).toFloat()
    val hourFormatter = remember {
        object : AxisValueFormatter<AxisPosition.Vertical.Start> {
            override fun formatValue(value: Float, chartValues: ChartValues): CharSequence =
                "${(value / 60f).roundToInt()}h"
        }
    }

    if (chartReady) {
        Chart(
            modifier = Modifier
                .fillMaxWidth()
                .height(160.dp),
            chart = lineChart(
                lines = listOf(spec),
                axisValuesOverrider = AxisValuesOverrider.fixed(minY = 0f, maxY = niceMaxMinutes),
            ),
            chartModelProducer = modelProducer,
            startAxis = rememberStartAxis(
                valueFormatter = hourFormatter,
                itemPlacer = AxisItemPlacer.Vertical.default(maxItemCount = steps + 1),
            ),
            bottomAxis = rememberBottomAxis(valueFormatter = labelFormatter),
        )
    } else {
        Spacer(
            Modifier
                .fillMaxWidth()
                .height(160.dp),
        )
    }

    Spacer(Modifier.height(8.dp))
    val peak = points.maxOfOrNull { it.value.roundToInt() } ?: 0
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(
            text = "last ${points.size} days",
            style = MaterialTheme.typography.labelSmall,
            color = muted,
        )
        Text(
            text = "best day ${formatMinutes(peak)}",
            style = MaterialTheme.typography.labelSmall,
            color = muted,
        )
    }
}

/** Fills gaps: a member with no aggregate for a date simply focused zero minutes that day. */
private fun CrewBoardRow.trendPoints(days: Int, today: LocalDate): List<TrendPoint> {
    val byDate = dailyAggregates.associateBy { it.localDate }
    return (days - 1 downTo 0).map { offset ->
        val date = today.minusDays(offset.toLong())
        TrendPoint(
            label = date.format(TREND_LABEL_FORMAT),
            value = (byDate[date.toString()]?.focusMinutes ?: 0).toFloat(),
        )
    }
}

private fun allTimeCaption(row: CrewBoardRow, history: List<TrendPoint>): String {
    val activeDays = history.count { it.value > 0f }
    val blocks = row.dailyAggregates.sumOf { it.completedWorkBlocks }
    return "${row.currentStreak} day streak · active $activeDays of the last ${history.size} days · " +
        "$blocks blocks in that window"
}

/** Pick a "nice" 1-2-5 hour step targeting ~5 ticks on the trend Y axis. */
private fun crewNiceHourStep(maxHours: Float): Int {
    if (maxHours <= 1f) return 1
    val raw = maxHours / 5f
    val mag = 10.0.pow(floor(log10(raw.toDouble()))).toFloat()
    val niceNorm = when {
        raw / mag <= 1f -> 1f
        raw / mag <= 2f -> 2f
        raw / mag <= 5f -> 5f
        else -> 10f
    }
    return (niceNorm * mag).roundToInt().coerceAtLeast(1)
}

private const val TREND_SEVEN: String = "7"
private const val TREND_THIRTY: String = "30"
private const val FINGERPRINT_CHARS: Int = 4

/** Snapshots carry at most this many days of daily totals, so the page cannot look further back. */
private val HISTORY_DAYS: Int = CrewValidation.MAX_DAILY_AGGREGATES

private val TREND_LABEL_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("d/M", Locale.getDefault())
