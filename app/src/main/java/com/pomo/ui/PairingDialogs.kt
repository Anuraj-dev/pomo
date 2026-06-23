package com.pomo.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.pomo.R
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.ui.theme.PomoRadius

internal data class PairingDialogData(
    val url: String,
    val token: String,
    val payload: String,
    val qr: ImageBitmap?,
)

internal data class ScanResultData(
    val message: String,
    val url: String,
)

@Composable
internal fun PairingDialog(
    data: PairingDialogData,
    onCopy: () -> Unit,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.pair_desktop_title)) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                data.qr?.let { qr ->
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(
                            bitmap = qr,
                            contentDescription = stringResource(R.string.pair_desktop_title),
                            modifier = Modifier
                                .size(220.dp)
                                .background(Color.White, RoundedCornerShape(PomoRadius.Sm))
                                .padding(12.dp),
                        )
                    }
                }
                LabelValue(stringResource(R.string.pairing_url_label), data.url)
                LabelValue(stringResource(R.string.pairing_token_label), data.token)
                LabelValue(stringResource(R.string.pairing_payload_label), data.payload)
            }
        },
        confirmButton = {
            TextButton(onClick = onCopy) { Text(stringResource(R.string.pairing_copy)) }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onShare) { Text(stringResource(R.string.pairing_share)) }
                TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.ok)) }
            }
        },
    )
}

@Composable
internal fun RotateTokenConfirmDialog(
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.rotate_pairing_token_title)) },
        text = { Text(stringResource(R.string.rotate_pairing_token_confirm)) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(stringResource(R.string.rotate_pairing_token_action))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.cancel)) }
        },
    )
}

@Composable
internal fun ScanResultDialog(
    data: ScanResultData,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.scan_pairing_qr_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(data.message, style = MaterialTheme.typography.bodyMedium)
                if (data.url.isNotBlank()) {
                    SelectionContainer {
                        Text(
                            data.url,
                            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = JetBrainsMono),
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(android.R.string.ok)) }
        },
    )
}

@Composable
private fun LabelValue(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SelectionContainer {
            Text(
                value,
                style = MaterialTheme.typography.bodyMedium.copy(fontFamily = JetBrainsMono),
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}
