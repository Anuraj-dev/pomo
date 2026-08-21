package com.pomo.sync.recovery

import com.pomo.sync.crypto.AesGcmCiphertext
import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.protocol.CborValue
import com.pomo.sync.protocol.DeterministicCbor
import com.pomo.sync.protocol.PomoSuite
import java.security.SecureRandom

internal enum class RecoveryArtifactKind { AUTHORITY_FILE, DATA_ARCHIVE }
internal data class RecoveryArtifact(val kind: RecoveryArtifactKind, val salt: ByteArray, val nonce: ByteArray, val ciphertextAndTag: ByteArray)
internal data class RecoveryFileBody(
    val protectedAuthority: ByteArray,
    val recoveryGeneration: Long,
    val frontierEvidence: List<String>,
    val capabilityLocators: List<String>,
    val mailboxLocators: List<String>,
)

internal data class RecoveryArchiveManifest(
    val archiveId: String,
    val recoveryGeneration: Long,
    val checkpointIds: List<String>,
    val packIds: List<String>,
    val blobIds: List<String>,
    val manifestDigest: ByteArray,
    val credentialProof: ByteArray?,
)

internal enum class RecoverySourceKind { DEVICE, MAILBOX, ARCHIVE }
internal data class ProvenancedRecoveryObject(val objectId: String, val sourceId: String, val sourceKind: RecoverySourceKind)

internal object RecoveryArtifactCodec {
    fun sealFile(body: RecoveryFileBody, passphrase: String, random: SecureRandom = SecureRandom()): RecoveryArtifact {
        require(body.protectedAuthority.size in 1..4_096)
        require(body.capabilityLocators.size <= 32 && body.mailboxLocators.size <= 32)
        val payload = DeterministicCbor.encode(
            CborValue.Array(listOf(CborValue.Integer(1), CborValue.Bytes(body.protectedAuthority), CborValue.Integer(body.recoveryGeneration),
                CborValue.Array(body.frontierEvidence.sorted().map(CborValue::Text)), CborValue.Array(body.capabilityLocators.sorted().map(CborValue::Text)),
                CborValue.Array(body.mailboxLocators.sorted().map(CborValue::Text)))),
        )
        return seal(RecoveryArtifactKind.AUTHORITY_FILE, payload, passphrase, random)
    }

    fun sealArchive(canonicalArchive: ByteArray, passphrase: String, random: SecureRandom = SecureRandom()): RecoveryArtifact {
        DeterministicCbor.decodeCanonical(canonicalArchive)
        return seal(RecoveryArtifactKind.DATA_ARCHIVE, canonicalArchive, passphrase, random)
    }

    fun validateArchiveManifest(manifest: RecoveryArchiveManifest, authorityGrantRequested: Boolean) {
        require(manifest.archiveId.isNotBlank() && manifest.recoveryGeneration >= 0)
        require(manifest.checkpointIds.isNotEmpty())
        require((manifest.checkpointIds + manifest.packIds + manifest.blobIds).distinct().size ==
            manifest.checkpointIds.size + manifest.packIds.size + manifest.blobIds.size)
        require(manifest.manifestDigest.size == 32)
        require(!authorityGrantRequested || !manifest.credentialProof.isNullOrEmpty()) {
            "Archive data never grants Recovery authority without credentials"
        }
    }

    fun open(artifact: RecoveryArtifact, passphrase: String): ByteArray {
        val key = PomoCrypto.argon2id(passphrase, artifact.salt)
        return try {
            PomoCrypto.decryptAesGcm(key, AesGcmCiphertext(artifact.nonce, artifact.ciphertextAndTag), aad(artifact.kind))
        } finally { key.fill(0) }
    }

    private fun seal(kind: RecoveryArtifactKind, plaintext: ByteArray, passphrase: String, random: SecureRandom): RecoveryArtifact {
        val salt = ByteArray(PomoSuite.ARGON2_SALT_BYTES).also(random::nextBytes)
        val nonce = ByteArray(PomoSuite.GCM_NONCE_BYTES).also(random::nextBytes)
        val key = PomoCrypto.argon2id(passphrase, salt)
        return try {
            val sealed = PomoCrypto.encryptAesGcm(key, nonce, aad(kind), plaintext)
            RecoveryArtifact(kind, salt, sealed.nonce, sealed.ciphertextAndTag)
        } finally { key.fill(0) }
    }

    private fun aad(kind: RecoveryArtifactKind): ByteArray = "Pomo Recovery Artifact:1:${kind.name}".toByteArray()
}

internal enum class RestoreDomain { HISTORY, TAG, PREFERENCE, PROFILE, CREW, ACTIVE_PHASE, DEVICE_KEY, CONTENT_EPOCH, RECOVERY_AUTHORITY }
internal data class RestoreSelection(val domain: RestoreDomain, val targetId: String, val compensatingPayload: ByteArray)
internal data class ForwardRestorePlan(val safetyCheckpointId: String, val compensating: List<RestoreSelection>, val independentConfirmationRequired: Boolean)

internal enum class RestorePlanOrigin { HUMAN, AGENT }
internal data class RestoreApproval(val humanConfirmed: Boolean, val independentConfirmed: Boolean)

internal data class HistoricalValue(
    val domain: RestoreDomain,
    val targetId: String,
    val causalVersion: Long,
    val operationId: String,
    val value: ByteArray?,
)

internal fun compareHistoricalValues(left: HistoricalValue, right: HistoricalValue): Int {
    require(left.domain == right.domain && left.targetId == right.targetId)
    return compareValuesBy(left, right, HistoricalValue::causalVersion, HistoricalValue::operationId)
}

internal fun prepareForwardRestore(safetyCheckpointId: String, selections: List<RestoreSelection>): ForwardRestorePlan {
    require(safetyCheckpointId.isNotBlank()) { "Safety checkpoint is required before restore" }
    val prohibited = setOf(RestoreDomain.ACTIVE_PHASE, RestoreDomain.DEVICE_KEY, RestoreDomain.CONTENT_EPOCH, RestoreDomain.RECOVERY_AUTHORITY)
    require(selections.none { it.domain in prohibited }) { "Recovery restore cannot rewind authority or Active phases" }
    require(selections.map { it.targetId }.distinct().size == selections.size)
    return ForwardRestorePlan(safetyCheckpointId, selections, selections.size >= 10)
}

internal fun authorizeForwardRestore(plan: ForwardRestorePlan, origin: RestorePlanOrigin, destructive: Boolean, approval: RestoreApproval) {
    require(approval.humanConfirmed) { "Forward restore requires human confirmation" }
    require(!(origin == RestorePlanOrigin.AGENT || destructive || plan.independentConfirmationRequired) || approval.independentConfirmed) {
        "Agent-prepared, destructive, or broad restore requires independent confirmation"
    }
}
