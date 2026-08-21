package com.pomo.sync.compat

internal data class CompatibilityProfile(
    val deviceId: String,
    val readableSchemas: Set<Int>,
    val writableSchemas: Set<Int>,
    val materializers: Set<Int>,
    val checkpointFormats: Set<Int>,
    val suiteGenerations: Set<Long>,
    val recoveryFormats: Set<Int>,
    val safeStorageGeneration: Int,
    val authenticated: Boolean,
)
internal data class AuthoringBaseline(val schema: Int, val materializer: Int, val checkpoint: Int, val suiteGeneration: Long, val recoveryFormat: Int, val storageGeneration: Int)
internal enum class CompatibilityMode { READY, LIMITED_FORWARD_ONLY, BLOCKED_AUTHORITY }
internal data class UnknownAuthenticatedFact(val operationId: String, val canonicalWire: ByteArray, val retainedForForwarding: Boolean = true)

internal fun compatibilityMode(profile: CompatibilityProfile, baseline: AuthoringBaseline): CompatibilityMode {
    if (!profile.authenticated || baseline.suiteGeneration !in profile.suiteGenerations || baseline.recoveryFormat !in profile.recoveryFormats) return CompatibilityMode.BLOCKED_AUTHORITY
    val ready = baseline.schema in profile.writableSchemas && baseline.materializer in profile.materializers &&
        baseline.checkpoint in profile.checkpointFormats && profile.safeStorageGeneration >= baseline.storageGeneration
    return if (ready) CompatibilityMode.READY else CompatibilityMode.LIMITED_FORWARD_ONLY
}

internal enum class ActivationDecision { PROPOSED, CONFIRMED, LIMITED_NAMED_DEVICES, QUARANTINED_CONCURRENT }
internal data class GenerationActivation(
    val generation: Long,
    val frontierId: String,
    val readerReadyDeviceIds: Set<String>,
    val proposerDeviceId: String,
    val confirmerDeviceId: String?,
    val confirmedByRecovery: Boolean,
    val explicitlyLimitedDeviceIds: Set<String>,
)

internal fun evaluateActivation(value: GenerationActivation, concurrentGenerations: Set<Long>): ActivationDecision {
    require(value.frontierId.isNotBlank() && value.proposerDeviceId in value.readerReadyDeviceIds) { "reader support must ship before proposal" }
    if (concurrentGenerations.any { it != value.generation }) return ActivationDecision.QUARANTINED_CONCURRENT
    require(value.confirmerDeviceId != value.proposerDeviceId || value.confirmedByRecovery) { "another Full device or Recovery must confirm" }
    require(
        value.confirmerDeviceId == null ||
            value.confirmerDeviceId in value.readerReadyDeviceIds ||
            value.confirmedByRecovery,
    ) { "confirmer must be a reader-ready Full device or Recovery" }
    if (value.confirmerDeviceId == null && !value.confirmedByRecovery) return ActivationDecision.PROPOSED
    return if (value.explicitlyLimitedDeviceIds.isEmpty()) ActivationDecision.CONFIRMED else ActivationDecision.LIMITED_NAMED_DEVICES
}

internal fun oldBuildDataDisposition(isSynchronizedHistory: Boolean, laterIndependentData: Boolean): String = when {
    isSynchronizedHistory -> "READ_ONLY"
    laterIndependentData -> "EXPLICIT_IMPORT_REQUIRED"
    else -> "LOCAL_ONLY"
}
