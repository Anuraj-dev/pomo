package com.pomo.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.pomo.ui.theme.PomoTheme

@Composable
public fun ComponentGalleryScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Text("Component gallery", style = MaterialTheme.typography.headlineMedium)

        GalleryBlock("Buttons") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PomoButton(onClick = {}) { Text("Filled") }
                PomoButton(onClick = {}, variant = PomoButtonVariant.Tonal) { Text("Tonal") }
                PomoButton(onClick = {}, variant = PomoButtonVariant.Ghost) {
                    Icon(Icons.Default.SkipNext, contentDescription = "Skip")
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PomoButton(onClick = {}, enabled = false) { Text("Disabled") }
                PomoButton(onClick = {}, loading = true) { Text("Loading") }
            }
        }

        GalleryBlock("Chips") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PhaseChip("Focus", MaterialTheme.colorScheme.primary)
                PhaseChip("Break", MaterialTheme.colorScheme.secondary)
            }
        }

        GalleryBlock("Stats") {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                StatTile("125m", "Today", delta = "+20m")
                StatTile("5", "Sessions", horizontalAlignment = androidx.compose.ui.Alignment.End)
            }
        }

        GalleryBlock("Empty") {
            EmptyState(
                headline = "No sessions yet",
                body = "Start a focus session to build history.",
                action = {
                    PomoButton(onClick = {}, variant = PomoButtonVariant.Tonal) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null)
                        Text("Start")
                    }
                },
            )
        }

        GalleryBlock("Toggle") {
            SegmentedToggle(
                options = listOf(
                    SegmentedToggleOption("today", "Today"),
                    SegmentedToggleOption("week", "Week"),
                    SegmentedToggleOption("month", "Month"),
                ),
                selectedValue = "week",
                onSelectedValueChange = {},
            )
        }
    }
}

@Composable
private fun GalleryBlock(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionHeader(title)
        content()
    }
}

@Preview(showBackground = true)
@Composable
private fun ComponentGalleryPreview() {
    PomoTheme {
        ComponentGalleryScreen()
    }
}
