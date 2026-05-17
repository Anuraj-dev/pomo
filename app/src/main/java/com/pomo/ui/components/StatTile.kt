package com.pomo.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import com.pomo.ui.theme.PomoTheme

@Composable
public fun StatTile(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    delta: String? = null,
    accentColor: Color = MaterialTheme.colorScheme.onSurface,
    horizontalAlignment: Alignment.Horizontal = Alignment.Start,
) {
    Column(modifier = modifier, horizontalAlignment = horizontalAlignment) {
        Text(
            text = value,
            style = MaterialTheme.typography.headlineLarge,
            color = accentColor,
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (delta != null) {
            Text(
                text = delta,
                style = MaterialTheme.typography.labelSmall,
                color = accentColor,
            )
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun StatTilePreview() {
    PomoTheme {
        StatTile(value = "125m", label = "Today", delta = "+20m")
    }
}
