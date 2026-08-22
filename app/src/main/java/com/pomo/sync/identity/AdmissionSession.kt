package com.pomo.sync.identity

import com.pomo.sync.protocol.ProtocolBytes

internal data class AdmissionSnapshot(
    val memberId: ProtocolBytes,
    val admissionId: ProtocolBytes,
    val deviceId: ProtocolBytes,
    val transcriptHash: ProtocolBytes,
    val stage: AdmissionStage,
)

/** Resumable admission state. Callers persist [snapshot] after every successful transition. */
internal class AdmissionSession private constructor(
    private var current: AdmissionSnapshot,
) {
    fun snapshot(): AdmissionSnapshot = current.copy()

    fun verifyFingerprints(
        memberId: ProtocolBytes,
        deviceId: ProtocolBytes,
        transcriptHash: ProtocolBytes,
    ) {
        check(current.stage == AdmissionStage.OFFER_CREATED)
        require(memberId == current.memberId) { "Member fingerprint mismatch" }
        require(deviceId == current.deviceId) { "Device fingerprint mismatch" }
        require(transcriptHash == current.transcriptHash) { "Admission transcript mismatch" }
        current = current.copy(stage = AdmissionStage.MUTUAL_FINGERPRINT_VERIFIED)
    }

    fun advance(next: AdmissionStage) {
        require(current.stage != AdmissionStage.IDENTITY_BLOCKED) { "Blocked identity cannot continue admission" }
        val linear = AdmissionStage.entries.filter { it != AdmissionStage.IDENTITY_BLOCKED }
        val expected = linear.getOrNull(linear.indexOf(current.stage) + 1)
        require(next == expected) { "Admission stages cannot be skipped or rewound" }
        current = current.copy(stage = next)
    }

    fun blockDifferentMember() {
        require(current.stage !in postAuthorizationStages) {
            "After authorization, cancel becomes revocation"
        }
        current = current.copy(stage = AdmissionStage.IDENTITY_BLOCKED)
    }

    companion object {
        fun create(snapshot: AdmissionSnapshot): AdmissionSession {
            require(snapshot.stage == AdmissionStage.OFFER_CREATED)
            return AdmissionSession(snapshot)
        }

        fun resume(snapshot: AdmissionSnapshot): AdmissionSession = AdmissionSession(snapshot)

        private val postAuthorizationStages =
            setOf(
                AdmissionStage.AUTHORIZATION_COMMITTED,
                AdmissionStage.BASELINE_VERIFIED,
                AdmissionStage.READY_ACK_COMMITTED,
            )
    }
}
