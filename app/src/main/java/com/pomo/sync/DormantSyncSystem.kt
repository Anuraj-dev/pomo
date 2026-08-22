package com.pomo.sync

internal fun interface AuthenticatedOperationIngress {
    /** The only synchronization ingress; implementations delegate to OperationKernel.ingest. */
    fun ingest(signedEnvelope: ByteArray): String
}

internal class DormantSyncSystem(
    private val ingress: AuthenticatedOperationIngress,
    private val mode: SyncActivationMode = syncActivationMode,
) {
    private var testSystemStarted = false

    fun startTestArtifact() {
        check(mode.testArtifact && !mode.productionActivated)
        testSystemStarted = true
    }

    fun start() {
        check(mode.testArtifact || mode.productionActivated) {
            "Dormant synchronization is unavailable in production"
        }
        testSystemStarted = true
    }

    fun ingestFromReplica(signedEnvelope: ByteArray): String {
        check(testSystemStarted) { "Dormant synchronization is unavailable in production" }
        return ingress.ingest(signedEnvelope.copyOf())
    }

    fun productionMigrationCutoverAllowed(): Boolean = false
}
