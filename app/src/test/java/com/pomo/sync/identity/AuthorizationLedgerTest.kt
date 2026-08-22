package com.pomo.sync.identity

import com.pomo.sync.protocol.FeedFrontier
import com.pomo.sync.protocol.PomoSuite
import com.pomo.sync.protocol.ProtocolBytes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class AuthorizationLedgerTest {
    @Test
    public fun admissionResumesWithoutSkippingFingerprintBaselineOrReadiness() {
        val initial = AdmissionSnapshot(id(1), id(2), id(3), id(4), AdmissionStage.OFFER_CREATED)
        val admission = AdmissionSession.create(initial)
        admission.verifyFingerprints(initial.memberId, initial.deviceId, initial.transcriptHash)
        val resumed = AdmissionSession.resume(admission.snapshot())
        assertEquals(AdmissionStage.MUTUAL_FINGERPRINT_VERIFIED, resumed.snapshot().stage)
        resumed.advance(AdmissionStage.INVENTORY_COMPLETE)
        resumed.advance(AdmissionStage.LOCAL_EXPORT_SAVED)
        resumed.advance(AdmissionStage.RECOVERY_ANCHOR_CREATED)
        resumed.advance(AdmissionStage.PLAN_APPROVED)
        resumed.advance(AdmissionStage.AUTHORIZATION_COMMITTED)
        resumed.advance(AdmissionStage.BASELINE_VERIFIED)
        resumed.advance(AdmissionStage.READY_ACK_COMMITTED)
        assertEquals(AdmissionStage.READY_ACK_COMMITTED, resumed.snapshot().stage)
    }

    @Test
    public fun differentMemberIdentityBlocksBeforeAuthorization() {
        val initial = AdmissionSnapshot(id(1), id(2), id(3), id(4), AdmissionStage.OFFER_CREATED)
        val admission = AdmissionSession.create(initial)
        admission.verifyFingerprints(initial.memberId, initial.deviceId, initial.transcriptHash)
        admission.blockDifferentMember()
        assertEquals(AdmissionStage.IDENTITY_BLOCKED, admission.snapshot().stage)
        assertTrue(runCatching { admission.advance(AdmissionStage.INVENTORY_COMPLETE) }.isFailure)
    }

    @Test
    public fun identityBlockAfterAuthorizationIsRevocation() {
        val initial = AdmissionSnapshot(id(1), id(2), id(3), id(4), AdmissionStage.OFFER_CREATED)
        val admission = AdmissionSession.create(initial)
        admission.verifyFingerprints(initial.memberId, initial.deviceId, initial.transcriptHash)
        admission.advance(AdmissionStage.INVENTORY_COMPLETE)
        admission.advance(AdmissionStage.LOCAL_EXPORT_SAVED)
        admission.advance(AdmissionStage.RECOVERY_ANCHOR_CREATED)
        admission.advance(AdmissionStage.PLAN_APPROVED)
        admission.advance(AdmissionStage.AUTHORIZATION_COMMITTED)
        assertTrue(runCatching { admission.blockDifferentMember() }.isFailure)
        admission.advance(AdmissionStage.BASELINE_VERIFIED)
        assertTrue(runCatching { admission.blockDifferentMember() }.isFailure)
        admission.advance(AdmissionStage.READY_ACK_COMMITTED)
        assertTrue(runCatching { admission.blockDifferentMember() }.isFailure)
    }

    @Test
    public fun genesisIsStableAndAuthorizationRemainsSeparateFromReadiness() {
        val first = certificate(1)
        val recovery = recovery(3)
        val genesis =
            MemberGenesis(
                PomoSuite.ID,
                PomoSuite.INITIAL_GENERATION,
                1,
                recovery,
                first,
            )
        val identity = IdentityCodec.memberIdentity(genesis)
        assertEquals(identity.memberId, IdentityCodec.memberIdentity(genesis).memberId)
        val ledger = AuthorizationLedger.fromGenesis(identity)
        val firstId = IdentityCodec.deviceId(first)
        val readyId = id(10)
        val readyFact = ready(firstId, identity.memberId)
        assertEquals(
            AuthorityDisposition.REJECTED_INVALID,
            ledger.apply(
                readyFact,
                id(9),
                firstId,
                false,
                listOf(FeedFrontier(firstId, incarnation(), 1, id(31))),
            ),
        )
        assertEquals(
            AuthorityDisposition.ACCEPTED,
            ledger.apply(
                readyFact,
                readyId,
                firstId,
                false,
                readyFact.baselineFrontier,
            ),
        )

        val joining = certificate(5)
        val joiningId = IdentityCodec.deviceId(joining)
        val admitId = id(11)
        assertEquals(
            AuthorityDisposition.ACCEPTED,
            ledger.apply(admit(identity.memberId, joining, joiningId, readyId), admitId, firstId, false),
        )
        assertTrue(ledger.snapshot().devices.getValue(joiningId).authorized)
        assertFalse(ledger.snapshot().devices.getValue(joiningId).deviceReady)
    }

    @Test
    public fun revocationPreservesEarlierRejectsKnowingLaterAndQuarantinesConcurrentWork() {
        val first = certificate(1)
        val identity =
            IdentityCodec.memberIdentity(
                MemberGenesis(PomoSuite.ID, PomoSuite.INITIAL_GENERATION, 1, recovery(3), first),
            )
        val firstId = IdentityCodec.deviceId(first)
        val target = certificate(5)
        val targetId = IdentityCodec.deviceId(target)
        val readyId = id(10)
        val admitId = id(11)
        val revokeId = id(12)
        val ledger = AuthorizationLedger.fromGenesis(identity)
        val readyFact = ready(firstId, identity.memberId)
        ledger.apply(
            readyFact,
            readyId,
            firstId,
            false,
            readyFact.baselineFrontier,
        )
        ledger.apply(admit(identity.memberId, target, targetId, readyId), admitId, firstId, false)
        assertEquals(
            AuthorityDisposition.ACCEPTED,
            ledger.apply(revoke(identity.memberId, targetId, readyId, admitId), revokeId, firstId, false),
        )
        val context = RevocationContext(identity.memberId, targetId, revokeId, setOf(id(20)))
        assertEquals(
            RevocationDisposition.NORMAL_VALIDATION,
            CausalRevocationClassifier.classify(identity.memberId, targetId, id(20), emptySet(), context),
        )
        assertEquals(
            RevocationDisposition.REJECT_KNOWINGLY_LATER,
            CausalRevocationClassifier.classify(identity.memberId, targetId, id(21), setOf(revokeId), context),
        )
        assertEquals(
            RevocationDisposition.QUARANTINE_CONCURRENT,
            CausalRevocationClassifier.classify(identity.memberId, targetId, id(22), emptySet(), context),
        )
    }

    private fun ready(
        deviceId: ProtocolBytes,
        memberId: ProtocolBytes,
    ): AuthorityFact =
        AuthorityFact(
            AuthorityFactKind.DEVICE_READY,
            memberId,
            null,
            null,
            deviceId,
            null,
            1,
            1,
            emptyList(),
            listOf(FeedFrontier(deviceId, incarnation(), 1, id(30))),
            null,
            null,
            null,
            null,
        )

    private fun admit(
        memberId: ProtocolBytes,
        certificate: DeviceCertificate,
        deviceId: ProtocolBytes,
        readyId: ProtocolBytes,
    ): AuthorityFact =
        AuthorityFact(
            AuthorityFactKind.ADMIT_DEVICE,
            memberId,
            id(40),
            id(41),
            deviceId,
            certificate,
            2,
            2,
            listOf(readyId),
            emptyList(),
            null,
            null,
            null,
            epoch(2),
        )

    private fun revoke(
        memberId: ProtocolBytes,
        targetId: ProtocolBytes,
        readyId: ProtocolBytes,
        admitId: ProtocolBytes,
    ): AuthorityFact =
        AuthorityFact(
            AuthorityFactKind.REVOKE_DEVICE,
            memberId,
            null,
            null,
            targetId,
            null,
            3,
            3,
            listOf(readyId, admitId),
            emptyList(),
            null,
            null,
            null,
            epoch(3),
        )

    private fun epoch(value: Long): ContentEpochAdvance =
        ContentEpochAdvance(id((50 + value).toInt()), value, emptyList(), id(60), emptyList())

    private fun certificate(seed: Int): DeviceCertificate {
        return DeviceCertificate(PomoSuite.ID, key(seed), key(seed + 1))
    }

    private fun recovery(seed: Int): RecoveryCertificate {
        return RecoveryCertificate(PomoSuite.ID, key(seed), key(seed + 1))
    }

    private fun key(seed: Int): ByteArray = ByteArray(65) { index -> if (index == 0) 4 else seed.toByte() }

    private fun id(seed: Int): ProtocolBytes = ProtocolBytes.of(ByteArray(32) { seed.toByte() }, 32)

    private fun incarnation(): ProtocolBytes = ProtocolBytes.of(ByteArray(16) { 7 }, 16)
}
