package com.pomo.sync.ui

public enum class SyncHealth {
    HEALTHY,
    OFFLINE,
    STALLED,
    QUARANTINE,
    CONFLICT,
    LIMITED,
    INCOMPLETE,
    SAFE_MODE,
}

public data class SyncSignal(
    val label: String,
    val value: String,
    val attention: Boolean,
)

public data class SyncWorkflow(
    val stage: String,
    val fingerprint: String?,
    val resumable: Boolean,
)

public data class SyncHistoryItem(
    val chronology: String,
    val provenance: String,
    val disposition: String,
    val projectionEffect: String,
)

public data class SyncRecoveryPreview(
    val anchor: String?,
    val comparison: String,
    val compensatingOperations: List<String>,
    val independentConfirmationRequired: Boolean,
)

public data class SyncUiState(
    val health: SyncHealth,
    val summary: String,
    val detail: String,
    val signals: List<SyncSignal>,
    val admission: SyncWorkflow,
    val migration: SyncWorkflow,
    val history: List<SyncHistoryItem>,
    val recovery: SyncRecoveryPreview,
    val affectedTimerDomain: Boolean,
    val retryPending: Boolean,
) {
    init {
        require(signals.map { it.label } == SIGNAL_LABELS)
    }

    public companion object {
        public val SIGNAL_LABELS: List<String> =
            listOf("Saved locally", "Peer-redundant", "Protected sync", "Attention")

        public val Dormant: SyncUiState =
            SyncUiState(
                health = SyncHealth.INCOMPLETE,
                summary = "Sync not activated",
                detail = "Saved locally. Complete admission before protected sync can author shared history.",
                signals =
                    listOf(
                        SyncSignal("Saved locally", "Current", false),
                        SyncSignal("Peer-redundant", "Not yet", false),
                        SyncSignal("Protected sync", "Incomplete", true),
                        SyncSignal("Attention", "Admission", true),
                    ),
                admission = SyncWorkflow("Not started", null, true),
                migration = SyncWorkflow("Not started", null, true),
                history = emptyList(),
                recovery = SyncRecoveryPreview(null, "No Recovery anchor selected", emptyList(), false),
                affectedTimerDomain = false,
                retryPending = false,
            )
    }
}

public fun scheduleOrdinaryDrain(state: SyncUiState): SyncUiState = state.copy(retryPending = true)

public fun completeOrdinaryDrain(state: SyncUiState): SyncUiState = state.copy(retryPending = false)

public fun timerControlsAllowed(state: SyncUiState): Boolean =
    !(state.affectedTimerDomain && state.health in setOf(SyncHealth.CONFLICT, SyncHealth.SAFE_MODE))

public object SyncSafetyGate {
    @Volatile
    public var state: SyncUiState = SyncUiState.Dormant
}
