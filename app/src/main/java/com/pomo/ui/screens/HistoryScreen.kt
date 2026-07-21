package com.pomo.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.LocalCafe
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.ShowChart
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.db.SessionEntity
import com.pomo.stats.HourRhythm
import com.pomo.stats.RhythmPattern
import com.pomo.ui.HistoryItem
import com.pomo.ui.TagPickerSheet
import com.pomo.ui.components.EmptyState
import com.pomo.ui.components.HourBarChart24
import com.pomo.ui.components.PomoSheet
import com.pomo.ui.components.rhythmCaption
import com.pomo.ui.theme.PomoTokens
import com.pomo.ui.theme.TimerTextStyle
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalFoundationApi::class)
@Composable
public fun HistoryScreen(
    items: List<HistoryItem>,
    loadRhythm: suspend (String) -> HourRhythm = { emptyRhythm() },
    loadSessions: suspend (String) -> List<SessionEntity> = { emptyList() },
    onTagSession: (Long, String?) -> Unit = { _, _ -> },
    availableTags: List<String> = emptyList(),
    isToday: (String) -> Boolean = { false },
) {
    val monthOptions = remember(items) { monthOptions(items) }
    val currentMonthKey = remember { currentMonthKey() }
    var selectedMonthKey by remember { mutableStateOf(currentMonthKey) }
    var selected by remember { mutableStateOf<HistoryItem?>(null) }
    val selectedLabel =
        monthOptions.firstOrNull { it.key == selectedMonthKey }?.label
            ?: if (selectedMonthKey == ALL_MONTHS_KEY) "All time" else formatMonthLabel(selectedMonthKey)
    val visibleItems =
        remember(items, selectedMonthKey) {
            if (selectedMonthKey == ALL_MONTHS_KEY) items else items.filter { it.date.startsWith(selectedMonthKey) }
        }
    val grouped = remember(visibleItems, selectedMonthKey) {
        if (selectedMonthKey == ALL_MONTHS_KEY) {
            groupByMonth(visibleItems)
        } else {
            listOf(selectedLabel to visibleItems)
        }
    }
    val totalMinutes = visibleItems.sumOf { it.entry.work_minutes }
    val totalBlocks = visibleItems.sumOf { it.entry.completed }

    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(20.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "History",
                    style = MaterialTheme.typography.displayMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(4.dp))
                MonthSelector(
                    label = selectedLabel,
                    options = monthOptions,
                    selectedKey = selectedMonthKey,
                    onSelect = { selectedMonthKey = it },
                )
            }
            if (items.isNotEmpty()) {
                MonthSummary(
                    totalMinutes = totalMinutes,
                    totalBlocks = totalBlocks,
                    modifier = Modifier.width(184.dp),
                )
            }
        }

        if (items.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                EmptyState(
                    headline = "No history yet",
                    body = "Finish a focus session and it will show up here.",
                    icon = Icons.Outlined.History,
                )
            }
            return@Column
        }

        Spacer(Modifier.height(16.dp))

        if (visibleItems.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                EmptyState(
                    headline = "No focus this month",
                    body = "Choose All time or another month to view your completed blocks.",
                    icon = Icons.Outlined.History,
                )
            }
            return@Column
        }

        LazyColumn(
            contentPadding = PaddingValues(bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            grouped.forEach { (monthLabel, entries) ->
                if (selectedMonthKey == ALL_MONTHS_KEY) {
                    stickyHeader(key = "header_$monthLabel") {
                        MonthSectionHeader(monthLabel)
                    }
                }
                items(entries, key = { it.date }) { entry ->
                    HistoryRow(
                        item = entry,
                        loadRhythm = loadRhythm,
                        isToday = isToday(entry.date),
                        onClick = { selected = entry },
                    )
                }
            }
        }
    }

    selected?.let { item ->
        DayDetailSheet(
            item = item,
            loadRhythm = loadRhythm,
            loadSessions = loadSessions,
            onTagSession = onTagSession,
            availableTags = availableTags,
            onDismiss = { selected = null },
        )
    }
}

private const val ALL_MONTHS_KEY: String = "__all__"

private data class MonthOption(
    val key: String,
    val label: String,
)

@Composable
private fun MonthSelector(
    label: String,
    options: List<MonthOption>,
    selectedKey: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Row(
            modifier =
                Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .clickable { expanded = true }
                    .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.titleMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
            Icon(
                imageVector = Icons.Outlined.KeyboardArrowDown,
                contentDescription = "Choose history period",
                tint = PomoTokens.colors.onSurfaceMuted,
                modifier = Modifier.size(20.dp),
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.background(PomoTokens.colors.surfaceElevated),
        ) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = {
                        Text(
                            option.label,
                            color = if (option.key == selectedKey) PomoTokens.colors.accent else PomoTokens.colors.onSurface,
                        )
                    },
                    onClick = {
                        onSelect(option.key)
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun MonthSummary(
    totalMinutes: Int,
    totalBlocks: Int,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .clip(RoundedCornerShape(18.dp))
                .background(PomoTokens.colors.surface)
                .padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SummaryMetric(
            icon = Icons.Outlined.AccessTime,
            value = formatMinutes(totalMinutes),
            label = "TOTAL TIME",
            modifier = Modifier.weight(1f),
        )
        Box(
            modifier =
                Modifier
                    .width(1.dp)
                    .height(34.dp)
                    .background(PomoTokens.colors.outline),
        )
        SummaryMetric(
            icon = Icons.Outlined.GridView,
            value = totalBlocks.toString(),
            label = "TOTAL BLOCKS",
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun SummaryMetric(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: String,
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = PomoTokens.colors.onSurfaceMuted,
            modifier = Modifier.size(16.dp),
        )
        Column {
            Text(
                value,
                style = TimerTextStyle.copy(fontSize = 14.sp),
                color = PomoTokens.colors.onSurface,
            )
            Text(
                label,
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 8.sp, letterSpacing = 0.06.sp),
                color = PomoTokens.colors.onSurfaceMuted,
            )
        }
    }
}

@Composable
private fun MonthSectionHeader(label: String) {
    Text(
        text = label.uppercase(Locale.US),
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.background)
                .padding(top = 8.dp, bottom = 2.dp),
        style = MaterialTheme.typography.labelSmall,
        color = PomoTokens.colors.onSurfaceMuted,
    )
}

@Composable
private fun HistoryRow(
    item: HistoryItem,
    loadRhythm: suspend (String) -> HourRhythm,
    isToday: Boolean,
    onClick: () -> Unit,
) {
    val date = remember(item.date) { parseDate(item.date) }
    val dayNumber = date?.let { SimpleDateFormat("d", Locale.US).format(it) } ?: "?"
    val weekday = date?.let { SimpleDateFormat("EEE", Locale.US).format(it).uppercase(Locale.US) } ?: ""
    val blocks = item.entry.completed
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(PomoTokens.colors.surface)
                .clickable(onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DateChip(dayNumber = dayNumber, weekday = weekday, isToday = isToday)
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = formatCompactDate(item.date),
                style = MaterialTheme.typography.titleMedium.copy(fontSize = 13.sp),
                color = PomoTokens.colors.onSurface,
                maxLines = 1,
            )
            Text(
                text = if (blocks == 1) "1 block" else "$blocks blocks",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                color = PomoTokens.colors.onSurfaceMuted,
            )
        }
        DailyRhythmPreview(loadRhythm = loadRhythm, date = item.date)
        Spacer(Modifier.width(8.dp))
        Icon(
            imageVector = Icons.Outlined.AccessTime,
            contentDescription = null,
            tint = PomoTokens.colors.accent,
            modifier = Modifier.size(17.dp),
        )
        Spacer(Modifier.width(4.dp))
        Text(
            text = formatMinutes(item.entry.work_minutes),
            style = TimerTextStyle.copy(fontSize = 14.sp),
            color = PomoTokens.colors.onSurface,
        )
        Icon(
            imageVector = Icons.Outlined.ChevronRight,
            contentDescription = "View ${formatCompactDate(item.date)} details",
            tint = PomoTokens.colors.onSurfaceMuted,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun DateChip(
    dayNumber: String,
    weekday: String,
    isToday: Boolean,
) {
    Column(
        modifier =
            Modifier
                .size(width = 42.dp, height = 48.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (isToday) PomoTokens.colors.accent else PomoTokens.colors.surfaceElevated)
                .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            dayNumber,
            style = MaterialTheme.typography.headlineMedium.copy(fontSize = 18.sp),
            color = PomoTokens.colors.onSurface,
        )
        Text(
            weekday,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp, letterSpacing = 0.04.sp),
            color = if (isToday) PomoTokens.colors.onSurface else PomoTokens.colors.onSurfaceMuted,
        )
    }
}

@Composable
private fun DailyRhythmPreview(
    loadRhythm: suspend (String) -> HourRhythm,
    date: String,
) {
    val rhythm by produceState(initialValue = emptyRhythm(), date) {
        value = runCatching { loadRhythm(date) }.getOrElse { emptyRhythm() }
    }
    val signal = PomoTokens.colors.accent
    val muted = PomoTokens.colors.onSurfaceMuted
    val outline = PomoTokens.colors.outline
    Canvas(
        modifier =
            Modifier
                .width(62.dp)
                .height(32.dp),
    ) {
        val groupCount = 10
        val gap = 2.dp.toPx()
        val barWidth = (size.width - gap * (groupCount - 1)) / groupCount
        val max = (rhythm.buckets.maxOrNull() ?: 0).coerceAtLeast(1)
        repeat(groupCount) { group ->
            val start = group * rhythm.buckets.size / groupCount
            val end = ((group + 1) * rhythm.buckets.size / groupCount).coerceAtMost(rhythm.buckets.size)
            val amount = rhythm.buckets.slice(start until end).maxOrNull() ?: 0
            val height = if (amount == 0) 2.dp.toPx() else 4.dp.toPx() + (amount.toFloat() / max) * (size.height - 6.dp.toPx())
            val left = group * (barWidth + gap)
            val top = size.height - height
            val isPeakGroup = rhythm.peakHour?.let { it in start until end } == true
            drawRoundRect(
                color = if (isPeakGroup) signal else muted,
                topLeft = Offset(left, top),
                size = Size(barWidth, height),
                cornerRadius = CornerRadius(2.dp.toPx()),
            )
        }
        drawRect(
            color = outline,
            topLeft = Offset(0f, size.height - 1.dp.toPx()),
            size = Size(size.width, 1.dp.toPx()),
        )
    }
}

private fun monthOptions(items: List<HistoryItem>): List<MonthOption> {
    val all = listOf(MonthOption(ALL_MONTHS_KEY, "All time"))
    val options =
        (items.map { it.date.take(7) } + currentMonthKey())
            .distinct()
            .sortedDescending()
            .map { MonthOption(it, formatMonthLabel(it)) }
    return options + all
}

private fun currentMonthKey(): String = SimpleDateFormat("yyyy-MM", Locale.US).format(Date())

private fun formatMonthLabel(key: String): String =
    runCatching {
        val input = SimpleDateFormat("yyyy-MM", Locale.US)
        val output = SimpleDateFormat("MMMM yyyy", Locale.US)
        output.format(input.parse(key) ?: return@runCatching key)
    }.getOrDefault(key)

private fun parseDate(iso: String): Date? =
    runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(iso) }.getOrNull()

/*
 * The selected day's detail still owns the full rhythm chart and sessions list. The compact
 * preview above intentionally samples the same rhythm data into ten bars so the list stays
 * glanceable without introducing a second history model.
 */

@Composable
private fun DayDetailSheet(
    item: HistoryItem,
    loadRhythm: suspend (String) -> HourRhythm,
    loadSessions: suspend (String) -> List<SessionEntity>,
    onTagSession: (Long, String?) -> Unit,
    availableTags: List<String>,
    onDismiss: () -> Unit,
) {
    val rhythm by produceState(initialValue = emptyRhythm(), item.date) {
        value = runCatching { loadRhythm(item.date) }.getOrElse { emptyRhythm() }
    }
    var sessions by remember { mutableStateOf(emptyList<SessionEntity>()) }
    LaunchedEffect(item.date) {
        sessions = runCatching { loadSessions(item.date) }.getOrElse { emptyList() }
    }
    var tagPickerSession by remember { mutableStateOf<Long?>(null) }
    val workSessions = sessions.filter { it.type == "work" && it.completed }

    PomoSheet(title = formatFullDate(item.date), onDismissRequest = onDismiss) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(
                text =
                    "${workSessions.size} sessions  •  ${rhythmCaption(rhythm)}  •  Tap a tag to edit",
                style = MaterialTheme.typography.bodyMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                DetailMetricCard(
                    icon = Icons.Outlined.RadioButtonChecked,
                    value = formatMinutes(item.entry.work_minutes),
                    label = "Focus",
                    accent = PomoTokens.colors.accent,
                    modifier = Modifier.weight(1f),
                )
                DetailMetricCard(
                    icon = Icons.Outlined.GridView,
                    value = item.entry.completed.toString(),
                    label = "Blocks",
                    accent = PomoTokens.colors.accent,
                    modifier = Modifier.weight(1f),
                )
                DetailMetricCard(
                    icon = Icons.Outlined.LocalCafe,
                    value = formatMinutes(item.entry.break_minutes),
                    label = "Break",
                    accent = PomoTokens.colors.onSurfaceMuted,
                    modifier = Modifier.weight(1f),
                )
            }

            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, PomoTokens.colors.outline, RoundedCornerShape(16.dp))
                        .padding(horizontal = 14.dp, vertical = 14.dp),
            ) {
                HourBarChart24(rhythm, showScale = true)
                Spacer(Modifier.height(10.dp))
                androidx.compose.material3.HorizontalDivider(color = PomoTokens.colors.outline.copy(alpha = 0.45f))
                Spacer(Modifier.height(10.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    androidx.compose.material3.Icon(
                        imageVector = Icons.Outlined.ShowChart,
                        contentDescription = null,
                        tint = PomoTokens.colors.accent,
                        modifier = Modifier.size(22.dp),
                    )
                    Text(
                        text = rhythmCaption(rhythm),
                        style = MaterialTheme.typography.bodyMedium,
                        color = PomoTokens.colors.onSurfaceMuted,
                    )
                }
            }

            if (workSessions.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        Text(
                            "Sessions",
                            style = MaterialTheme.typography.titleLarge,
                            color = PomoTokens.colors.onSurface,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "Tap tag to change",
                            style = MaterialTheme.typography.bodySmall,
                            color = PomoTokens.colors.onSurfaceMuted,
                        )
                    }
                    Column(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .border(1.dp, PomoTokens.colors.outline, RoundedCornerShape(14.dp)),
                    ) {
                        workSessions.forEachIndexed { index, session ->
                            SessionRow(
                                session = session,
                                onTagClick = { tagPickerSession = session.start },
                            )
                            if (index < workSessions.lastIndex) {
                                androidx.compose.material3.HorizontalDivider(
                                    color = PomoTokens.colors.outline.copy(alpha = 0.45f),
                                )
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
    }

    tagPickerSession?.let { startTime ->
        val currentSession = sessions.find { it.start == startTime }
        TagPickerSheet(
            tags = availableTags,
            currentTag = currentSession?.tag,
            onSelect = { tag ->
                onTagSession(startTime, tag)
                sessions =
                    sessions.map {
                        if (it.start == startTime) it.copy(tag = tag) else it
                    }
                tagPickerSession = null
            },
            onDismiss = { tagPickerSession = null },
        )
    }
}

@Composable
private fun SessionRow(
    session: SessionEntity,
    onTagClick: () -> Unit,
) {
    val displayTime =
        remember(session.start) {
            SimpleDateFormat("HH:mm", Locale.US).format(session.start * 1000L)
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = displayTime,
            style = TimerTextStyle.copy(fontSize = 14.sp),
            color = PomoTokens.colors.onSurface,
            modifier = Modifier.width(62.dp),
        )
        Text(
            text = formatMinutes(session.duration / 60),
            style = TimerTextStyle.copy(fontSize = 14.sp),
            color = PomoTokens.colors.onSurfaceMuted,
            modifier = Modifier.width(48.dp),
        )
        Row(
            modifier =
                Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(PomoTokens.colors.surfaceElevated)
                    .clickable(onClick = onTagClick)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Box(
                modifier =
                    Modifier
                        .size(7.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (session.tag == "Study") PomoTokens.colors.accent else PomoTokens.colors.onSurfaceMuted),
            )
            Text(
                text = session.tag ?: "tag",
                style = MaterialTheme.typography.labelSmall,
                color = if (session.tag != null) PomoTokens.colors.onSurface else PomoTokens.colors.onSurfaceMuted,
            )
        }
        Spacer(Modifier.weight(1f))
        androidx.compose.material3.IconButton(
            onClick = onTagClick,
            modifier = Modifier.size(36.dp),
        ) {
            androidx.compose.material3.Icon(
                imageVector = Icons.Outlined.Edit,
                contentDescription = "Edit ${session.tag ?: "tag"}",
                tint = PomoTokens.colors.onSurfaceMuted,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun DetailMetricCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: String,
    label: String,
    accent: androidx.compose.ui.graphics.Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .clip(RoundedCornerShape(14.dp))
                .border(1.dp, PomoTokens.colors.outline, RoundedCornerShape(14.dp))
                .padding(horizontal = 10.dp, vertical = 11.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        androidx.compose.material3.Icon(
            imageVector = icon,
            contentDescription = null,
            tint = accent,
            modifier = Modifier.size(20.dp),
        )
        Column {
            Text(
                value,
                style = TimerTextStyle.copy(fontSize = 15.sp),
                color = PomoTokens.colors.onSurface,
            )
            Text(
                label,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                color = PomoTokens.colors.onSurfaceMuted,
            )
        }
    }
}

private fun emptyRhythm(): HourRhythm = HourRhythm(IntArray(24), null, RhythmPattern.None)

private fun groupByMonth(items: List<HistoryItem>): List<Pair<String, List<HistoryItem>>> {
    if (items.isEmpty()) return emptyList()
    val sorted = items.sortedByDescending { it.date }
    val parse = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val monthFmt = SimpleDateFormat("MMMM yyyy", Locale.US)
    val out = mutableListOf<Pair<String, MutableList<HistoryItem>>>()
    sorted.forEach { item ->
        val date = parse.parse(item.date) ?: return@forEach
        val cal = Calendar.getInstance().apply { time = date }
        val key = monthFmt.format(cal.time)
        if (out.isEmpty() || out.last().first != key) {
            out += key to mutableListOf(item)
        } else {
            out.last().second += item
        }
    }
    return out.map { it.first to it.second.toList() }
}

private fun formatFullDate(iso: String): String =
    try {
        val input = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val output = SimpleDateFormat("EEEE, MMMM d", Locale.US)
        input.parse(iso)?.let { output.format(it) } ?: iso
    } catch (_: Exception) {
        iso
    }

private fun formatCompactDate(iso: String): String =
    try {
        val input = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val output = SimpleDateFormat("EEEE, MMM d", Locale.US)
        input.parse(iso)?.let { output.format(it) } ?: iso
    } catch (_: Exception) {
        iso
    }
