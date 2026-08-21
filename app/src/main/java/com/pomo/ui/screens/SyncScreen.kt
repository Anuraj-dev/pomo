package com.pomo.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.pomo.sync.ui.SyncHealth
import com.pomo.sync.ui.SyncHistoryItem
import com.pomo.sync.ui.SyncSignal
import com.pomo.sync.ui.SyncUiState
import com.pomo.sync.ui.SyncWorkflow
import com.pomo.ui.components.PomoButton
import com.pomo.ui.components.PomoButtonVariant
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.ui.theme.PomoTokens

@Composable
public fun SyncScreen(
    state: SyncUiState,
    onRetry: () -> Unit,
    onResumeAdmission: () -> Unit,
    onResumeMigration: () -> Unit,
    onConfirmRecovery: () -> Unit,
    onExportDiagnostics: () -> Unit,
) {
    LazyColumn(
        modifier =
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 18.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Sync", style = MaterialTheme.typography.displayMedium)
                    Text(state.summary, color = PomoTokens.colors.onSurfaceMuted)
                }
                Text(
                    state.health.name.replace('_', ' '),
                    fontFamily = JetBrainsMono,
                    color = healthColor(state.health),
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                state.detail,
                style = MaterialTheme.typography.bodyMedium,
                color = PomoTokens.colors.onSurfaceMuted,
            )
        }
        item { SignalRail(state.signals) }
        item {
            PomoButton(
                onClick = onRetry,
                enabled = !state.retryPending,
                variant = PomoButtonVariant.Tonal,
            ) {
                Text(if (state.retryPending) "Retry scheduled" else "Retry now")
            }
            Text(
                "Schedules the ordinary drain. Safety state is preserved.",
                style = MaterialTheme.typography.bodySmall,
                color = PomoTokens.colors.onSurfaceFaint,
            )
        }
        item { WorkflowSection("Admission", state.admission, onResumeAdmission) }
        item { WorkflowSection("Migration", state.migration, onResumeMigration) }
        item {
            SectionTitle("Data History")
            Text(
                "Causal chronology · provenance · disposition · projection effect",
                color = PomoTokens.colors.onSurfaceMuted,
            )
        }
        if (state.history.isEmpty()) {
            item {
                Text(
                    "No synchronized Operations yet. Local history remains available.",
                    color = PomoTokens.colors.onSurfaceMuted,
                )
            }
        }
        items(state.history) { HistoryRow(it) }
        item {
            SectionTitle("Recovery workbench")
            Text(
                "${state.recovery.anchor ?: "No anchor"} · ${state.recovery.comparison}",
                color = PomoTokens.colors.onSurfaceMuted,
            )
            if (state.recovery.compensatingOperations.isEmpty()) {
                Text(
                    "No compensating Operations selected.",
                    color = PomoTokens.colors.onSurfaceFaint,
                )
            }
            state.recovery.compensatingOperations.forEach {
                Text("• $it", fontFamily = JetBrainsMono)
            }
            Spacer(Modifier.height(8.dp))
            PomoButton(
                onClick = onConfirmRecovery,
                enabled =
                    state.recovery.compensatingOperations.isNotEmpty() &&
                        !state.recovery.independentConfirmationRequired,
            ) {
                Text("Confirm forward restore")
            }
            Text(
                "Creates a Safety checkpoint first. Active phases and authority cannot be rewound.",
                style = MaterialTheme.typography.bodySmall,
                color = PomoTokens.colors.onSurfaceFaint,
            )
        }
        item {
            SectionTitle("Diagnostics")
            Text(
                "Sanitized local evidence only. No implicit upload or centralized telemetry.",
                color = PomoTokens.colors.onSurfaceMuted,
            )
            Spacer(Modifier.height(8.dp))
            PomoButton(onClick = onExportDiagnostics, variant = PomoButtonVariant.Tonal) {
                Text("Export diagnostics")
            }
        }
    }
}

@Composable
private fun SignalRail(signals: List<SyncSignal>) {
    Column(Modifier.fillMaxWidth()) {
        SectionTitle("Signal rail")
        signals.forEachIndexed { index, signal ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(signal.label, color = PomoTokens.colors.onSurfaceMuted)
                Text(
                    signal.value,
                    fontFamily = JetBrainsMono,
                    fontWeight = FontWeight.SemiBold,
                    color =
                        if (signal.attention) {
                            PomoTokens.colors.accent
                        } else {
                            MaterialTheme.colorScheme.onSurface
                        },
                )
            }
            if (index != signals.lastIndex) {
                HorizontalDivider(color = PomoTokens.colors.outline)
            }
        }
    }
}

@Composable
private fun WorkflowSection(
    title: String,
    workflow: SyncWorkflow,
    onResume: () -> Unit,
) {
    Column {
        SectionTitle(title)
        Text(workflow.stage, color = PomoTokens.colors.onSurfaceMuted)
        Text(
            workflow.fingerprint ?: "Fingerprint pending",
            fontFamily = JetBrainsMono,
            style = MaterialTheme.typography.bodySmall,
            color = PomoTokens.colors.onSurfaceFaint,
        )
        if (workflow.resumable) {
            Spacer(Modifier.height(8.dp))
            PomoButton(onClick = onResume, variant = PomoButtonVariant.Tonal) {
                Text("Resume $title")
            }
        }
    }
}

@Composable
private fun HistoryRow(item: SyncHistoryItem) {
    Column(Modifier.fillMaxWidth()) {
        Text(item.chronology, fontFamily = JetBrainsMono)
        Text(item.provenance, color = PomoTokens.colors.onSurfaceMuted)
        Text(
            "${item.disposition} · ${item.projectionEffect}",
            style = MaterialTheme.typography.bodySmall,
            color = PomoTokens.colors.onSurfaceFaint,
        )
        HorizontalDivider(
            modifier = Modifier.padding(top = 10.dp),
            color = PomoTokens.colors.outline,
        )
    }
}

@Composable
private fun SectionTitle(value: String) {
    Text(
        value,
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurface,
    )
}

@Composable
private fun healthColor(health: SyncHealth) =
    if (health in setOf(SyncHealth.CONFLICT, SyncHealth.QUARANTINE, SyncHealth.SAFE_MODE)) {
        PomoTokens.colors.accent
    } else {
        PomoTokens.colors.onSurfaceMuted
    }
