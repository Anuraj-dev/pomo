package com.pomo.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarDefaults
import androidx.compose.material3.Snackbar as MaterialSnackbar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
public fun PomoSnackbarHost(
    hostState: SnackbarHostState,
    modifier: Modifier = Modifier,
) {
    SnackbarHost(hostState = hostState, modifier = modifier) { data ->
        MaterialSnackbar(
            snackbarData = data,
            containerColor = MaterialTheme.colorScheme.surfaceVariant,
            contentColor = MaterialTheme.colorScheme.onSurface,
            actionColor = MaterialTheme.colorScheme.primary,
            dismissActionContentColor = SnackbarDefaults.dismissActionContentColor,
        )
    }
}
