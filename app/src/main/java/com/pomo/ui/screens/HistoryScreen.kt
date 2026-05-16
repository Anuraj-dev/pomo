package com.pomo.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.ui.HistoryItem
import com.pomo.ui.components.EmptyState
import com.pomo.ui.components.SectionHeader
import com.pomo.ui.theme.PomoTokens
import com.pomo.ui.theme.TimerTextStyle
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

@Composable
public fun HistoryScreen(items: List<HistoryItem>) {
    val grouped = remember(items) { groupByMonth(items) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 20.dp),
    ) {
        Spacer(Modifier.height(16.dp))
        Text(
            "History",
            style = MaterialTheme.typography.displayMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(12.dp))

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

        LazyColumn(
            contentPadding = PaddingValues(top = 8.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            grouped.forEach { (monthLabel, entries) ->
                item(key = "header_$monthLabel") {
                    Column {
                        Spacer(Modifier.height(20.dp))
                        SectionHeader(monthLabel)
                        Spacer(Modifier.height(8.dp))
                    }
                }
                items(entries, key = { it.date }) { entry ->
                    HistoryRow(entry)
                    HorizontalDivider(
                        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.6f),
                        thickness = 1.dp,
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryRow(item: HistoryItem) {
    val pomoColors = PomoTokens.colors
    val displayDate = remember(item.date) { formatDate(item.date) }
    val hours = item.entry.work_minutes / 60
    val mins = item.entry.work_minutes % 60
    val focusText = if (hours > 0) "${hours}h ${mins}m" else "${mins}m"
    val sessions = item.entry.completed
    val dotColor = when {
        sessions == 0 -> MaterialTheme.colorScheme.outline
        sessions >= 8 -> pomoColors.accent
        else -> pomoColors.focus
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(dotColor),
        )
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(
                displayDate,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                if (sessions == 1) "1 session" else "$sessions sessions",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            focusText,
            style = TimerTextStyle.copy(fontSize = 18.sp),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

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

private fun formatDate(iso: String): String = try {
    val input = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    val output = SimpleDateFormat("EEE, MMM d", Locale.US)
    input.parse(iso)?.let { output.format(it) } ?: iso
} catch (_: Exception) {
    iso
}
