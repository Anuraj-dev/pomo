package com.pomo.sync.identity

import com.pomo.sync.protocol.FeedFrontier
import com.pomo.sync.protocol.ProtocolBytes

internal data class DeviceCertificate(
    val suite: Int,
    val signingPublicKey: ByteArray,
    val agreementPublicKey: ByteArray,
)

internal data class RecoveryCertificate(
    val suite: Int,
    val signingPublicKey: ByteArray,
    val agreementPublicKey: ByteArray,
)

internal data class MemberGenesis(
    val suite: Int,
    val suiteGeneration: Long,
    val recoveryGeneration: Long,
    val recoveryCertificate: RecoveryCertificate,
    val firstDeviceCertificate: DeviceCertificate,
)

internal data class GenesisRecord(
    val body: MemberGenesis,
    val recoverySignature: ByteArray,
    val firstDeviceSignature: ByteArray,
)

internal data class MemberIdentity(
    val memberId: ProtocolBytes,
    val canonicalGenesis: ByteArray,
    val genesis: MemberGenesis,
)

internal enum class AdmissionStage {
    OFFER_CREATED,
    MUTUAL_FINGERPRINT_VERIFIED,
    AUTHORIZATION_COMMITTED,
    BASELINE_VERIFIED,
    READY_ACK_COMMITTED,
}

internal enum class AuthorityFactKind {
    ADMIT_DEVICE,
    REVOKE_DEVICE,
    DEVICE_READY,
    RECOVERY_ROTATE,
    RECOVERY_RESET,
}

internal enum class RecoveryRotateMode {
    NORMAL,
    EMERGENCY_DEVICE_ROTATION,
}

internal enum class RecipientKind {
    DEVICE,
    RECOVERY,
}

internal data class ContentEpochRecipientWrap(
    val kind: RecipientKind,
    val recipientId: ProtocolBytes,
    val encapsulatedKey: ByteArray,
    val ciphertextAndTag: ByteArray,
)

internal data class ContentEpochAdvance(
    val epochId: ProtocolBytes,
    val epoch: Long,
    val parentEpochIds: List<ProtocolBytes>,
    val authorizationFrontierDigest: ProtocolBytes,
    val recipientWraps: List<ContentEpochRecipientWrap>,
)

internal data class AuthorityFact(
    val kind: AuthorityFactKind,
    val memberId: ProtocolBytes,
    val admissionId: ProtocolBytes?,
    val transcriptHash: ProtocolBytes?,
    val subjectDeviceId: ProtocolBytes?,
    val subjectCertificate: DeviceCertificate?,
    val authorizationEpoch: Long,
    val contentEpoch: Long,
    val ledgerFrontier: List<ProtocolBytes>,
    val baselineFrontier: List<FeedFrontier>,
    val recoveryGeneration: Long?,
    val recoveryCertificate: RecoveryCertificate?,
    val recoveryRotateMode: RecoveryRotateMode?,
    val contentEpochAdvance: ContentEpochAdvance?,
)

internal data class SignedAuthorityFact(
    val canonicalFact: ByteArray,
    val factId: ProtocolBytes,
    val signerId: ProtocolBytes,
    val signature: ByteArray,
    val recoverySigned: Boolean,
)

internal enum class RevocationDisposition {
    NORMAL_VALIDATION,
    REJECT_KNOWINGLY_LATER,
    QUARANTINE_CONCURRENT,
    QUARANTINE_DIFFERENT_MEMBER,
}

internal data class RevocationContext(
    val memberId: ProtocolBytes,
    val targetDeviceId: ProtocolBytes,
    val revocationFactId: ProtocolBytes,
    val capturedTargetFrontier: Set<ProtocolBytes>,
)

internal data class EpochRecipient(
    val recipientId: ProtocolBytes,
    val agreementPublicKey: ByteArray,
    val recovery: Boolean,
)

internal data class ContentEpochWrap(
    val recipientId: ProtocolBytes,
    val recovery: Boolean,
    val encapsulatedKey: ByteArray,
    val ciphertextAndTag: ByteArray,
)

internal data class ContentEpochMaterial(
    val epoch: Long,
    val authorizationEpoch: Long,
    val frontierDigest: ProtocolBytes,
    val wraps: List<ContentEpochWrap>,
)
