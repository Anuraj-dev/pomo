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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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
import com.pomo.ui.components.SectionHeader
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.ui.theme.PomoRadius
import com.pomo.ui.theme.PomoTokens

@Composable
public fun SyncScreen(
    state: SyncUiState,
    onRetry: () -> Unit,
    onResumeAdmission: () -> Unit,
    onResumeMigration: () -> Unit,
    onConfirmRecovery: () -> Unit,
    onExportDiagnostics: () -> Unit,
    onBack: () -> Unit,
    onAdmitRemote: (String) -> Unit = {},
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
    ) {
        Row(
            modifier = Modifier.padding(start = 8.dp, top = 12.dp, end = 20.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back to profile",
                    tint = MaterialTheme.colorScheme.onSurface,
                )
            }
            Spacer(Modifier.width(4.dp))
            Text(
                "Sync",
                style = MaterialTheme.typography.displayMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }

        LazyColumn(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item {
                SyncCard {
                    Text(
                        state.health.name.replace('_', ' '),
                        fontFamily = JetBrainsMono,
                        fontWeight = FontWeight.SemiBold,
                        color = healthColor(state.health),
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(
                        state.summary,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        state.detail,
                        style = MaterialTheme.typography.bodyMedium,
                        color = PomoTokens.colors.onSurfaceMuted,
                    )
                    Spacer(Modifier.height(12.dp))
                    PomoButton(
                        onClick = onRetry,
                        enabled = !state.retryPending,
                        variant = PomoButtonVariant.Tonal,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (state.retryPending) "Retry scheduled" else "Retry now")
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Schedules the ordinary drain. Safety state is preserved.",
                        style = MaterialTheme.typography.bodySmall,
                        color = PomoTokens.colors.onSurfaceFaint,
                    )
                }
            }
            item {
                SectionBlock(title = "Signal rail") {
                    SignalRail(state.signals)
                }
            }
            item {
                SectionBlock(title = "Admission") {
                    WorkflowBody(state.admission, "Admission", onResumeAdmission)
                    if (state.admissionOffer.isNotEmpty()) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "Local offer. Compare fingerprints, then paste the other replica here.",
                            style = MaterialTheme.typography.bodySmall,
                            color = PomoTokens.colors.onSurfaceMuted,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            state.admissionOffer,
                            fontFamily = JetBrainsMono,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                    var remoteOffer by remember { mutableStateOf("") }
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = remoteOffer,
                        onValueChange = { remoteOffer = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Other replica offer") },
                        minLines = 3,
                    )
                    Spacer(Modifier.height(12.dp))
                    PomoButton(
                        onClick = { onAdmitRemote(remoteOffer) },
                        enabled = remoteOffer.isNotBlank(),
                        variant = PomoButtonVariant.Tonal,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Admit pasted offer")
                    }
                }
            }
            item {
                SectionBlock(title = "Migration") {
                    WorkflowBody(state.migration, "Migration", onResumeMigration)
                }
            }
            item {
                SectionBlock(title = "Data History") {
                    Text(
                        "Causal chronology · provenance · disposition · projection effect",
                        style = MaterialTheme.typography.bodySmall,
                        color = PomoTokens.colors.onSurfaceMuted,
                    )
                    Spacer(Modifier.height(12.dp))
                    if (state.history.isEmpty()) {
                        Text(
                            "No synchronized Operations yet. Local history remains available.",
                            color = PomoTokens.colors.onSurfaceMuted,
                        )
                    } else {
                        state.history.forEachIndexed { index, item ->
                            if (index > 0) {
                                HorizontalDivider(
                                    modifier = Modifier.padding(vertical = 10.dp),
                                    color = PomoTokens.colors.outline,
                                )
                            }
                            HistoryRow(item)
                        }
                    }
                }
            }
            item {
                SectionBlock(title = "Recovery workbench") {
                    Text(
                        "${state.recovery.anchor ?: "No anchor"} · ${state.recovery.comparison}",
                        color = PomoTokens.colors.onSurfaceMuted,
                    )
                    Spacer(Modifier.height(8.dp))
                    if (state.recovery.compensatingOperations.isEmpty()) {
                        Text(
                            "No compensating Operations selected.",
                            color = PomoTokens.colors.onSurfaceFaint,
                        )
                    } else {
                        state.recovery.compensatingOperations.forEach {
                            Text("• $it", fontFamily = JetBrainsMono)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    PomoButton(
                        onClick = onConfirmRecovery,
                        enabled =
                            state.recovery.compensatingOperations.isNotEmpty() &&
                                !state.recovery.independentConfirmationRequired,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Confirm forward restore")
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Creates a Safety checkpoint first. Active phases and authority cannot be rewound.",
                        style = MaterialTheme.typography.bodySmall,
                        color = PomoTokens.colors.onSurfaceFaint,
                    )
                }
            }
            item {
                SectionBlock(title = "Diagnostics") {
                    Text(
                        "Sanitized local evidence only. No implicit upload or centralized telemetry.",
                        color = PomoTokens.colors.onSurfaceMuted,
                    )
                    Spacer(Modifier.height(12.dp))
                    PomoButton(
                        onClick = onExportDiagnostics,
                        variant = PomoButtonVariant.Tonal,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Export diagnostics")
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionBlock(
    title: String,
    content: @Composable () -> Unit,
) {
    Column {
        SectionHeader(title, modifier = Modifier.padding(start = 4.dp, bottom = 10.dp))
        SyncCard(content)
    }
}

@Composable
private fun SyncCard(content: @Composable () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(PomoRadius.Lg),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp)) {
            content()
        }
    }
}

@Composable
private fun SignalRail(signals: List<SyncSignal>) {
    if (signals.isEmpty()) {
        Text("No signals yet.", color = PomoTokens.colors.onSurfaceMuted)
        return
    }
    signals.forEachIndexed { index, signal ->
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
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

@Composable
private fun WorkflowBody(
    workflow: SyncWorkflow,
    title: String,
    onResume: () -> Unit,
) {
    Text(workflow.stage, color = MaterialTheme.colorScheme.onSurface)
    Spacer(Modifier.height(4.dp))
    Text(
        workflow.fingerprint ?: "Fingerprint pending",
        fontFamily = JetBrainsMono,
        style = MaterialTheme.typography.bodySmall,
        color = PomoTokens.colors.onSurfaceFaint,
    )
    if (workflow.resumable) {
        Spacer(Modifier.height(12.dp))
        PomoButton(
            onClick = onResume,
            variant = PomoButtonVariant.Tonal,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Resume $title")
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
    }
}

@Composable
private fun healthColor(health: SyncHealth) =
    if (health in setOf(SyncHealth.CONFLICT, SyncHealth.QUARANTINE, SyncHealth.SAFE_MODE)) {
        PomoTokens.colors.accent
    } else {
        PomoTokens.colors.onSurfaceMuted
    }
