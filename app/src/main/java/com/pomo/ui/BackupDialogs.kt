package com.pomo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pomo.R
import com.pomo.ui.components.PomoDialog

internal data class RestorePreviewData(
    val sessionCount: Int,
    val crewCount: Int,
    val hasIdentity: Boolean,
    val exportedOn: String,
)

@Composable
internal fun RestoreConfirmDialog(
    data: RestorePreviewData,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    PomoDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.backup_restore_title)) },
        body = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    stringResource(
                        R.string.backup_restore_contents,
                        pluralStringResource(R.plurals.backup_sessions, data.sessionCount, data.sessionCount),
                        pluralStringResource(R.plurals.backup_crews, data.crewCount, data.crewCount),
                        data.exportedOn,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    stringResource(R.string.backup_restore_merge_note),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (data.hasIdentity) {
                    Text(
                        stringResource(R.string.backup_restore_identity_note),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        actions = {
            TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.cancel)) }
            TextButton(onClick = onConfirm) { Text(stringResource(R.string.backup_restore_action)) }
        },
    )
}
