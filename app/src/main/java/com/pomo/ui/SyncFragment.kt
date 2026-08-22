package com.pomo.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.pomo.MainActivity
import com.pomo.sync.diagnostics.DiagnosticEvent
import com.pomo.sync.diagnostics.DiagnosticExporter
import com.pomo.sync.diagnostics.EvidenceArea
import com.pomo.sync.transport.OrdinaryDrainScheduler
import com.pomo.sync.ui.SyncSafetyGate
import com.pomo.sync.ui.completeOrdinaryDrain
import com.pomo.sync.ui.scheduleOrdinaryDrain
import com.pomo.ui.screens.SyncScreen
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.ThemeMode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

public class SyncFragment : Fragment() {
    private val diagnosticExport =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/x-ndjson")) { uri ->
            if (uri == null) return@registerForActivityResult
            viewLifecycleOwner.lifecycleScope.launch(Dispatchers.IO) {
                requireContext().contentResolver.openOutputStream(uri)?.use { output ->
                    DiagnosticExporter.export(
                        events =
                            sequenceOf(
                                DiagnosticEvent(
                                    monotonicMillis = android.os.SystemClock.elapsedRealtime(),
                                    area = EvidenceArea.STATE_TRANSITION,
                                    event = "export-requested",
                                    fields = mapOf("outcome" to "local-only"),
                                ),
                            ),
                        output = output,
                        cancelled = { !isActive },
                    )
                }
            }
        }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View =
        ComposeView(requireContext()).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                PomoTheme(mode = (activity as? MainActivity)?.prefs?.themeMode ?: ThemeMode.System) {
                    var state by remember { mutableStateOf(SyncSafetyGate.state) }
                    SyncScreen(
                        state = state,
                        onRetry = {
                            state = scheduleOrdinaryDrain(state)
                            SyncSafetyGate.state = state
                            if (OrdinaryDrainScheduler.hostAllowed()) {
                                OrdinaryDrainScheduler.enqueueNow(requireContext())
                            } else {
                                state = completeOrdinaryDrain(state)
                                SyncSafetyGate.state = state
                            }
                        },
                        onResumeAdmission = {
                            if (state.admission.resumable) {
                                state =
                                    state.copy(
                                        admission = state.admission.copy(stage = "Resumed locally"),
                                    )
                                SyncSafetyGate.state = state
                            }
                        },
                        onResumeMigration = {
                            if (state.migration.resumable) {
                                state =
                                    state.copy(
                                        migration = state.migration.copy(stage = "Resumed locally"),
                                    )
                                SyncSafetyGate.state = state
                            }
                        },
                        onConfirmRecovery = {
                            if (state.recovery.compensatingOperations.isNotEmpty() &&
                                !state.recovery.independentConfirmationRequired
                            ) {
                                state =
                                    state.copy(
                                        recovery =
                                            state.recovery.copy(
                                                compensatingOperations = emptyList(),
                                                comparison = "Forward restore confirmed. Safety checkpoint retained.",
                                            ),
                                    )
                                SyncSafetyGate.state = state
                            }
                        },
                        onExportDiagnostics = {
                            diagnosticExport.launch("pomo-diagnostics.ndjson")
                        },
                        onBack = { findNavController().popBackStack() },
                    )
                }
            }
        }
}
