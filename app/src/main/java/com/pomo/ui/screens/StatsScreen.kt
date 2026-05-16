package com.pomo.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.QueryStats
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.db.SessionEntity
import com.pomo.ui.DayEntry
import com.pomo.ui.components.EmptyState
import com.pomo.ui.components.SectionHeader
import com.pomo.ui.components.SegmentedToggle
import com.pomo.ui.components.SegmentedToggleOption
import com.pomo.ui.components.StatTile
import com.pomo.ui.theme.PomoTokens
import com.pomo.ui.theme.TimerTextStyle
import com.pomo.util.DateLogic
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.absoluteValue

public enum class StatsRange(public val days: Int, public val label: String) {
    Week(7, "Week"),
    Month(30, "Month"),
    All(0, "All");
}

@Composable
public fun StatsScreen(
    history: Map<String, DayEntry>,
    today: String,
    todaySessions: List<SessionEntity>,
    dailyGoal: Int,
    sessionMinutes: Int = 25,
    onExport: () -> Unit,
) {
    val scroll = rememberScrollState()
    var range by rememberSaveable { mutableStateOf(StatsRange.Week) }

    val rangeData = remember(history, range, today) { computeRange(history, range, today) }
    val previousData = remember(history, range, today) { computePrevious(history, range, today) }

    val activeDates = remember(history) {
        history.entries.filter { it.value.completed > 0 }.map { it.key }.toSet()
    }
    val currentStreak = remember(activeDates) {
        DateLogic.currentStreak(activeDates, System.currentTimeMillis())
    }
    val bestStreak = remember(activeDates) { DateLogic.bestStreak(activeDates) }
    val goalPct30 = remember(history, today, dailyGoal) {
        goalCompletionRate(history, today, dailyGoal, days = 30)
    }
    val hours = remember(todaySessions) { hourBuckets(todaySessions) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(scroll)
            .padding(horizontal = 20.dp, vertical = 16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Statistics",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.displayMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            IconButton(onClick = onExport) {
                Icon(
                    Icons.Outlined.Download,
                    contentDescription = "Export statistics",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(16.dp))

        SegmentedToggle(
            options = listOf(
                SegmentedToggleOption(StatsRange.Week.name, "Week"),
                SegmentedToggleOption(StatsRange.Month.name, "Month"),
                SegmentedToggleOption(StatsRange.All.name, "All"),
            ),
            selectedValue = range.name,
            onSelectedValueChange = { range = StatsRange.valueOf(it) },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(24.dp))

        if (rangeData.totalMinutes == 0) {
            EmptyState(
                headline = "No sessions yet",
                body = "Run a focus session to start building your history.",
                icon = Icons.Outlined.QueryStats,
                modifier = Modifier.fillMaxWidth().padding(top = 32.dp),
            )
            return@Column
        }

        HeroLine(
            totalMinutes = rangeData.totalMinutes,
            previousMinutes = previousData.totalMinutes,
            showDelta = range != StatsRange.All,
            rangeLabel = range,
        )
        Spacer(Modifier.height(24.dp))

        SectionHeader("Consistency")
        Spacer(Modifier.height(12.dp))
        Box(Modifier.horizontalScroll(rememberScrollState())) {
            Heatmap(
                history = history,
                today = today,
                weeks = when (range) {
                    StatsRange.Week -> 12
                    StatsRange.Month -> 26
                    StatsRange.All -> 52
                },
            )
        }
        Spacer(Modifier.height(24.dp))

        SectionHeader("Today's hours")
        Spacer(Modifier.height(8.dp))
        if (todaySessions.isEmpty()) {
            Text(
                "No sessions today yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = muted,
                modifier = Modifier.padding(vertical = 12.dp),
            )
        } else {
            HourDistribution(buckets = hours)
        }
        Spacer(Modifier.height(24.dp))

        SectionHeader("Streak")
        Spacer(Modifier.height(12.dp))
        StreakBlock(currentStreak = currentStreak, bestStreak = bestStreak)
        Spacer(Modifier.height(24.dp))

        SectionHeader("Goal completion")
        Spacer(Modifier.height(12.dp))
        GoalCompletionBlock(
            pct = goalPct30,
            dailyGoal = dailyGoal,
            sessionMinutes = sessionMinutes,
        )
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun HeroLine(
    totalMinutes: Int,
    previousMinutes: Int,
    showDelta: Boolean,
    rangeLabel: StatsRange,
) {
    val pomoColors = PomoTokens.colors
    val hours = totalMinutes / 60
    val mins = totalMinutes % 60
    val hero = if (hours > 0) "${hours}h ${mins}m" else "${mins}m"

    Column {
        Text(
            text = hero,
            style = TimerTextStyle.copy(fontSize = 48.sp),
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "Focus, ${rangeLabel.label.lowercase()}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (showDelta && previousMinutes > 0) {
                Spacer(Modifier.width(8.dp))
                val delta = totalMinutes - previousMinutes
                val arrow = when {
                    delta > 0 -> "↑"
                    delta < 0 -> "↓"
                    else -> "="
                }
                val color = when {
                    delta > 0 -> pomoColors.success
                    delta < 0 -> pomoColors.warn
                    else -> pomoColors.onSurfaceMuted
                }
                val absMin = delta.absoluteValue
                val absH = absMin / 60
                val absM = absMin % 60
                val deltaText = if (absH > 0) "${absH}h ${absM}m" else "${absM}m"
                Text(
                    text = "$arrow $deltaText vs previous",
                    style = MaterialTheme.typography.bodySmall,
                    color = color,
                )
            }
        }
    }
}

@Composable
private fun Heatmap(history: Map<String, DayEntry>, today: String, weeks: Int) {
    val focus = MaterialTheme.colorScheme.primary
    val empty = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
    val cell = 12.dp
    val gap = 4.dp

    Canvas(
        modifier = Modifier.size(
            width = (cell + gap) * weeks + gap,
            height = (cell + gap) * 7 + gap,
        ),
    ) {
        val cellPx = cell.toPx()
        val gapPx = gap.toPx()
        val df = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val todayDate = df.parse(today) ?: return@Canvas
        val start = Calendar.getInstance().apply {
            time = todayDate
            add(Calendar.WEEK_OF_YEAR, -(weeks - 1))
            set(Calendar.DAY_OF_WEEK, Calendar.SUNDAY)
        }
        val cal = start.clone() as Calendar
        for (w in 0 until weeks) {
            for (d in 0 until 7) {
                if (cal.time.after(todayDate)) return@Canvas
                val key = df.format(cal.time)
                val entry = history[key]
                val sessions = entry?.completed ?: 0
                val mins = entry?.work_minutes ?: 0
                val color = when {
                    sessions == 0 -> empty
                    mins < 30 -> focus.copy(alpha = 0.30f)
                    mins < 60 -> focus.copy(alpha = 0.55f)
                    mins < 120 -> focus.copy(alpha = 0.80f)
                    else -> focus
                }
                val left = gapPx + w * (cellPx + gapPx)
                val top = gapPx + d * (cellPx + gapPx)
                drawRoundRect(
                    color = color,
                    topLeft = Offset(left, top),
                    size = Size(cellPx, cellPx),
                    cornerRadius = CornerRadius(3.dp.toPx()),
                )
                cal.add(Calendar.DAY_OF_YEAR, 1)
            }
        }
    }
}

@Composable
private fun HourDistribution(buckets: IntArray) {
    val focus = MaterialTheme.colorScheme.primary
    val empty = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val max = (buckets.maxOrNull() ?: 1).coerceAtLeast(1)

    Column(Modifier.fillMaxWidth()) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(80.dp),
        ) {
            val w = size.width
            val h = size.height
            val gap = 2.dp.toPx()
            val barW = (w - gap * 23) / 24f
            val radius = CornerRadius(2.dp.toPx())
            for (i in 0 until 24) {
                val frac = buckets[i].toFloat() / max
                val barH = (h * frac).coerceAtLeast(if (buckets[i] > 0) 2f else 1f)
                val left = i * (barW + gap)
                val top = h - barH
                drawRoundRect(
                    color = if (buckets[i] > 0) focus else empty,
                    topLeft = Offset(left, top),
                    size = Size(barW, barH),
                    cornerRadius = radius,
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth()) {
            HourLabel("6am", Modifier.weight(1f), TextAlign.Start, muted)
            HourLabel("12pm", Modifier.weight(1f), TextAlign.Center, muted)
            HourLabel("6pm", Modifier.weight(1f), TextAlign.Center, muted)
            HourLabel("12am", Modifier.weight(1f), TextAlign.End, muted)
        }
    }
}

@Composable
private fun HourLabel(text: String, modifier: Modifier, align: TextAlign, color: Color) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.labelSmall,
        textAlign = align,
        color = color,
    )
}

@Composable
private fun StreakBlock(currentStreak: Int, bestStreak: Int) {
    val pomoColors = PomoTokens.colors
    val streakColor = if (currentStreak >= bestStreak && currentStreak > 0) {
        pomoColors.accent
    } else {
        MaterialTheme.colorScheme.primary
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(40.dp),
    ) {
        StatTile(
            value = "$currentStreak",
            label = "current days",
            accentColor = streakColor,
            modifier = Modifier.weight(1f),
        )
        StatTile(
            value = "$bestStreak",
            label = "longest days",
            accentColor = pomoColors.accent,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun GoalCompletionBlock(pct: Float, dailyGoal: Int, sessionMinutes: Int) {
    val track = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f)
    val accent = PomoTokens.colors.accent
    val percentText = "${(pct * 100).toInt()}%"

    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(80.dp),
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 8.dp.toPx()
                val inset = stroke / 2f
                drawArc(
                    color = track,
                    startAngle = -90f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = Size(size.width - inset * 2, size.height - inset * 2),
                    style = Stroke(width = stroke, cap = StrokeCap.Round),
                )
                if (pct > 0f) {
                    drawArc(
                        color = accent,
                        startAngle = -90f,
                        sweepAngle = 360f * pct.coerceIn(0f, 1f),
                        useCenter = false,
                        topLeft = Offset(inset, inset),
                        size = Size(size.width - inset * 2, size.height - inset * 2),
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                }
            }
            Text(
                text = percentText,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Spacer(Modifier.width(20.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "Last 30 days",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "Goal: $dailyGoal × ${sessionMinutes}m per day",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// Data helpers

private data class RangeData(val totalMinutes: Int, val totalSessions: Int)

private fun computeRange(
    history: Map<String, DayEntry>,
    range: StatsRange,
    today: String,
): RangeData {
    val df = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val todayDate = df.parse(today) ?: return RangeData(0, 0)
    val cal = Calendar.getInstance().apply { time = todayDate }
    if (range == StatsRange.All) {
        var m = 0; var s = 0
        history.values.forEach { m += it.work_minutes; s += it.completed }
        return RangeData(m, s)
    }
    val days = range.days
    var minutes = 0
    var sessions = 0
    val iter = cal.clone() as Calendar
    iter.add(Calendar.DAY_OF_YEAR, -(days - 1))
    repeat(days) {
        val key = df.format(iter.time)
        history[key]?.let {
            minutes += it.work_minutes
            sessions += it.completed
        }
        iter.add(Calendar.DAY_OF_YEAR, 1)
    }
    return RangeData(minutes, sessions)
}

private fun computePrevious(
    history: Map<String, DayEntry>,
    range: StatsRange,
    today: String,
): RangeData {
    if (range == StatsRange.All) return RangeData(0, 0)
    val df = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val todayDate = df.parse(today) ?: return RangeData(0, 0)
    val days = range.days
    val iter = Calendar.getInstance().apply {
        time = todayDate
        add(Calendar.DAY_OF_YEAR, -(days * 2 - 1))
    }
    var minutes = 0
    var sessions = 0
    repeat(days) {
        val key = df.format(iter.time)
        history[key]?.let {
            minutes += it.work_minutes
            sessions += it.completed
        }
        iter.add(Calendar.DAY_OF_YEAR, 1)
    }
    return RangeData(minutes, sessions)
}

private fun hourBuckets(sessions: List<SessionEntity>): IntArray {
    val buckets = IntArray(24)
    val cal = Calendar.getInstance()
    sessions.filter { it.type == "work" }.forEach {
        cal.time = Date(it.start)
        val h = cal.get(Calendar.HOUR_OF_DAY)
        buckets[h] += (it.duration / 60).toInt().coerceAtLeast(1)
    }
    return buckets
}

private fun goalCompletionRate(
    history: Map<String, DayEntry>,
    today: String,
    dailyGoal: Int,
    days: Int,
): Float {
    if (dailyGoal <= 0) return 0f
    val df = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val todayDate = df.parse(today) ?: return 0f
    val iter = Calendar.getInstance().apply {
        time = todayDate
        add(Calendar.DAY_OF_YEAR, -(days - 1))
    }
    var hit = 0
    repeat(days) {
        val key = df.format(iter.time)
        val completed = history[key]?.completed ?: 0
        if (completed >= dailyGoal) hit += 1
        iter.add(Calendar.DAY_OF_YEAR, 1)
    }
    return hit.toFloat() / days
}
