package com.pomo.sync.identity

import com.pomo.sync.protocol.FeedFrontier
import com.pomo.sync.protocol.ProtocolBytes

internal enum class AuthorityDisposition {
    ACCEPTED,
    DUPLICATE,
    PENDING_CAUSAL,
    QUARANTINED_CONCURRENT_AUTHORITY,
    QUARANTINED_DIFFERENT_MEMBER,
    REJECTED_INVALID,
    REJECTED_STALE_RECOVERY,
}

internal data class DeviceAuthorityProjection(
    val certificate: DeviceCertificate,
    val authorized: Boolean,
    val deviceReady: Boolean,
    val admittedAtEpoch: Long,
    val revokedAtEpoch: Long?,
)

internal data class AuthorizationProjection(
    val memberId: ProtocolBytes,
    val authorizationEpoch: Long,
    val contentEpoch: Long,
    val recoveryGeneration: Long,
    val recoveryCertificate: RecoveryCertificate,
    val devices: Map<ProtocolBytes, DeviceAuthorityProjection>,
    val acceptedFactIds: Set<ProtocolBytes>,
)

internal class AuthorizationLedger private constructor(
    private var projection: AuthorizationProjection,
    private val firstDeviceId: ProtocolBytes,
) {
    fun snapshot(): AuthorizationProjection =
        projection.copy(
            devices = projection.devices.toMap(),
            acceptedFactIds = projection.acceptedFactIds.toSet(),
        )

    fun apply(
        fact: AuthorityFact,
        factId: ProtocolBytes,
        issuerDeviceId: ProtocolBytes?,
        recoverySignatureVerified: Boolean,
        verifiedBaselineFrontier: List<FeedFrontier>? = null,
    ): AuthorityDisposition {
        if (fact.memberId != projection.memberId) return AuthorityDisposition.QUARANTINED_DIFFERENT_MEMBER
        if (factId in projection.acceptedFactIds) return AuthorityDisposition.DUPLICATE
        if (!projection.acceptedFactIds.containsAll(fact.ledgerFrontier)) return AuthorityDisposition.PENDING_CAUSAL
        return when (fact.kind) {
            AuthorityFactKind.ADMIT_DEVICE -> applyAdmit(fact, factId, issuerDeviceId)
            AuthorityFactKind.DEVICE_READY -> applyReady(fact, factId, issuerDeviceId, verifiedBaselineFrontier)
            AuthorityFactKind.REVOKE_DEVICE -> applyRevoke(fact, factId, issuerDeviceId)
            AuthorityFactKind.RECOVERY_ROTATE -> applyRotate(fact, factId, issuerDeviceId, recoverySignatureVerified)
            AuthorityFactKind.RECOVERY_RESET -> applyReset(fact, factId, recoverySignatureVerified)
        }
    }

    private fun applyAdmit(
        fact: AuthorityFact,
        factId: ProtocolBytes,
        issuerDeviceId: ProtocolBytes?,
    ): AuthorityDisposition {
        if (!authorizedAndReady(issuerDeviceId) || fact.authorizationEpoch != projection.authorizationEpoch + 1) {
            return AuthorityDisposition.REJECTED_INVALID
        }
        val certificate = fact.subjectCertificate ?: return AuthorityDisposition.REJECTED_INVALID
        val deviceId = IdentityCodec.deviceId(certificate)
        if (fact.subjectDeviceId != deviceId || projection.devices[deviceId]?.authorized == true) {
            return AuthorityDisposition.REJECTED_INVALID
        }
        if (!validEpochAdvance(fact)) return AuthorityDisposition.REJECTED_INVALID
        projection =
            projection.copy(
                authorizationEpoch = fact.authorizationEpoch,
                contentEpoch = fact.contentEpoch,
                devices =
                    projection.devices +
                        (deviceId to DeviceAuthorityProjection(certificate, true, false, fact.authorizationEpoch, null)),
                acceptedFactIds = projection.acceptedFactIds + factId,
            )
        return AuthorityDisposition.ACCEPTED
    }

    private fun applyReady(
        fact: AuthorityFact,
        factId: ProtocolBytes,
        issuerDeviceId: ProtocolBytes?,
        verifiedBaselineFrontier: List<FeedFrontier>?,
    ): AuthorityDisposition {
        val deviceId = fact.subjectDeviceId ?: return AuthorityDisposition.REJECTED_INVALID
        val device = projection.devices[deviceId] ?: return AuthorityDisposition.REJECTED_INVALID
        val expectedBaselineDevices =
            projection.devices.filter { (knownDeviceId, knownDevice) ->
                knownDevice.authorized && (knownDeviceId != deviceId || knownDeviceId == firstDeviceId)
            }.keys
        val baselineDevices = fact.baselineFrontier.map { it.deviceId }.toSet()
        if (issuerDeviceId != deviceId || !device.authorized || fact.authorizationEpoch != projection.authorizationEpoch ||
            fact.contentEpoch != projection.contentEpoch ||
            (fact.baselineFrontier.isEmpty() && expectedBaselineDevices.isNotEmpty()) ||
            baselineDevices.size != fact.baselineFrontier.size || baselineDevices != expectedBaselineDevices ||
            verifiedBaselineFrontier == null ||
            verifiedBaselineFrontier.toSet() != fact.baselineFrontier.toSet() ||
            verifiedBaselineFrontier.size != fact.baselineFrontier.size
        ) {
            return AuthorityDisposition.REJECTED_INVALID
        }
        projection =
            projection.copy(
                devices = projection.devices + (deviceId to device.copy(deviceReady = true)),
                acceptedFactIds = projection.acceptedFactIds + factId,
            )
        return AuthorityDisposition.ACCEPTED
    }

    private fun applyRevoke(
        fact: AuthorityFact,
        factId: ProtocolBytes,
        issuerDeviceId: ProtocolBytes?,
    ): AuthorityDisposition {
        val deviceId = fact.subjectDeviceId ?: return AuthorityDisposition.REJECTED_INVALID
        val device = projection.devices[deviceId] ?: return AuthorityDisposition.REJECTED_INVALID
        if (!authorizedAndReady(issuerDeviceId) || !device.authorized ||
            fact.authorizationEpoch != projection.authorizationEpoch + 1 || !validEpochAdvance(fact)
        ) {
            return AuthorityDisposition.REJECTED_INVALID
        }
        projection =
            projection.copy(
                authorizationEpoch = fact.authorizationEpoch,
                contentEpoch = fact.contentEpoch,
                devices =
                    projection.devices +
                        (deviceId to device.copy(authorized = false, deviceReady = false, revokedAtEpoch = fact.authorizationEpoch)),
                acceptedFactIds = projection.acceptedFactIds + factId,
            )
        return AuthorityDisposition.ACCEPTED
    }

    private fun applyRotate(
        fact: AuthorityFact,
        factId: ProtocolBytes,
        issuerDeviceId: ProtocolBytes?,
        recoverySignatureVerified: Boolean,
    ): AuthorityDisposition {
        if (fact.recoveryGeneration != projection.recoveryGeneration + 1) {
            return if (fact.recoveryGeneration == projection.recoveryGeneration) {
                AuthorityDisposition.QUARANTINED_CONCURRENT_AUTHORITY
            } else {
                AuthorityDisposition.REJECTED_STALE_RECOVERY
            }
        }
        val authorityValid =
            when (fact.recoveryRotateMode) {
                RecoveryRotateMode.NORMAL -> recoverySignatureVerified && authorizedAndReady(issuerDeviceId)
                RecoveryRotateMode.EMERGENCY_DEVICE_ROTATION -> !recoverySignatureVerified && authorizedAndReady(issuerDeviceId)
                null -> false
            }
        val certificate = fact.recoveryCertificate
        if (!authorityValid || certificate == null) return AuthorityDisposition.REJECTED_INVALID
        projection =
            projection.copy(
                recoveryGeneration = fact.recoveryGeneration,
                recoveryCertificate = certificate,
                acceptedFactIds = projection.acceptedFactIds + factId,
            )
        return AuthorityDisposition.ACCEPTED
    }

    private fun applyReset(
        fact: AuthorityFact,
        factId: ProtocolBytes,
        recoverySignatureVerified: Boolean,
    ): AuthorityDisposition {
        if (!recoverySignatureVerified || fact.recoveryGeneration != projection.recoveryGeneration + 1 ||
            fact.authorizationEpoch != projection.authorizationEpoch + 1 || !validEpochAdvance(fact)
        ) {
            return AuthorityDisposition.REJECTED_STALE_RECOVERY
        }
        val certificate = fact.subjectCertificate ?: return AuthorityDisposition.REJECTED_INVALID
        val deviceId = IdentityCodec.deviceId(certificate)
        val recovery = fact.recoveryCertificate ?: return AuthorityDisposition.REJECTED_INVALID
        if (fact.subjectDeviceId != deviceId) return AuthorityDisposition.REJECTED_INVALID
        val retired =
            projection.devices.mapValues { (_, device) ->
                device.copy(authorized = false, deviceReady = false, revokedAtEpoch = fact.authorizationEpoch)
            }
        projection =
            projection.copy(
                authorizationEpoch = fact.authorizationEpoch,
                contentEpoch = fact.contentEpoch,
                recoveryGeneration = fact.recoveryGeneration,
                recoveryCertificate = recovery,
                devices =
                    retired +
                        (deviceId to DeviceAuthorityProjection(certificate, true, false, fact.authorizationEpoch, null)),
                acceptedFactIds = projection.acceptedFactIds + factId,
            )
        return AuthorityDisposition.ACCEPTED
    }

    private fun authorizedAndReady(deviceId: ProtocolBytes?): Boolean =
        deviceId?.let { projection.devices[it] }?.let { it.authorized && it.deviceReady } == true

    private fun validEpochAdvance(fact: AuthorityFact): Boolean =
        fact.contentEpoch == projection.contentEpoch + 1 && fact.contentEpochAdvance?.epoch == fact.contentEpoch

    companion object {
        fun fromGenesis(identity: MemberIdentity): AuthorizationLedger {
            val first = identity.genesis.firstDeviceCertificate
            val firstId = IdentityCodec.deviceId(first)
            return AuthorizationLedger(
                AuthorizationProjection(
                    memberId = identity.memberId,
                    authorizationEpoch = 1,
                    contentEpoch = 1,
                    recoveryGeneration = 1,
                    recoveryCertificate = identity.genesis.recoveryCertificate,
                    devices = mapOf(firstId to DeviceAuthorityProjection(first, true, false, 1, null)),
                    acceptedFactIds = emptySet(),
                ),
                firstId,
            )
        }
    }
}

internal object CausalRevocationClassifier {
    fun classify(
        operationMemberId: ProtocolBytes,
        operationDeviceId: ProtocolBytes,
        operationId: ProtocolBytes,
        operationAuthorityFrontier: Set<ProtocolBytes>,
        revocation: RevocationContext,
    ): RevocationDisposition {
        if (operationMemberId != revocation.memberId) return RevocationDisposition.QUARANTINE_DIFFERENT_MEMBER
        if (operationDeviceId != revocation.targetDeviceId) return RevocationDisposition.NORMAL_VALIDATION
        if (operationId in revocation.capturedTargetFrontier) return RevocationDisposition.NORMAL_VALIDATION
        if (revocation.revocationFactId in operationAuthorityFrontier) {
            return RevocationDisposition.REJECT_KNOWINGLY_LATER
        }
        return RevocationDisposition.QUARANTINE_CONCURRENT
    }
}
