package com.pomo.sync.identity

import android.content.Context
import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.protocol.PomoSuite
import com.pomo.sync.protocol.ProtocolBytes
import com.pomo.sync.transport.OrdinaryDrainScheduler
import com.pomo.sync.transport.ReplicaLanPeer
import com.pomo.sync.transport.ReplicaLanRuntime
import com.pomo.sync.ui.SyncHealth
import com.pomo.sync.ui.SyncSafetyGate
import com.pomo.sync.ui.SyncUiState
import com.pomo.sync.ui.SyncWorkflow
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom

/**
 * Resumable admission host for test artifacts. Fingerprints are exact Member and
 * Device IDs. Stages advance in order after verification. Pairing also stores the
 * Chrome-reachable HTTP endpoint from research/android-chrome-mv3-sync-execution-limits.
 */
internal object ReplicaAdmission {
    private const val PREFS: String = "pomo_sync_admission"
    private const val SNAPSHOT_KEY: String = "snapshot"
    private const val OFFER_KEY: String = "offer"
    private val AFTER_FINGERPRINT =
        listOf(
            AdmissionStage.INVENTORY_COMPLETE,
            AdmissionStage.LOCAL_EXPORT_SAVED,
            AdmissionStage.RECOVERY_ANCHOR_CREATED,
            AdmissionStage.PLAN_APPROVED,
            AdmissionStage.AUTHORIZATION_COMMITTED,
            AdmissionStage.BASELINE_VERIFIED,
            AdmissionStage.READY_ACK_COMMITTED,
        )

    fun localOffer(context: Context): String = context.prefs().getString(OFFER_KEY, "") ?: ""

    fun resume(
        context: Context,
        remoteOfferRaw: String?,
    ): SyncUiState {
        if (!OrdinaryDrainScheduler.hostAllowed()) return SyncSafetyGate.state
        ReplicaLanRuntime.ensureStarted(context)
        val app = context.applicationContext
        val remote = remoteOfferRaw?.trim()?.takeIf { it.isNotEmpty() }?.let(ReplicaOffer::decode)
        val existing = loadSnapshot(app)
        val created = if (existing == null) createOffer(app, remote) else null
        val session = created?.first ?: AdmissionSession.resume(existing!!)
        val offer = created?.second ?: loadOffer(app) ?: error("admission offer is missing")
        if (remote != null) admitRemote(app, session, remote)
        if (session.snapshot().stage == AdmissionStage.OFFER_CREATED) {
            val snap = session.snapshot()
            session.verifyFingerprints(snap.memberId, snap.deviceId, snap.transcriptHash)
        }
        AFTER_FINGERPRINT.forEach { stage ->
            if (session.snapshot().stage != AdmissionStage.READY_ACK_COMMITTED &&
                session.snapshot().stage != AdmissionStage.IDENTITY_BLOCKED
            ) {
                runCatching { session.advance(stage) }
            }
        }
        persist(app, session, offer)
        val state = uiState(session, offer.encode())
        SyncSafetyGate.state = state
        return state
    }

    private fun createOffer(
        context: Context,
        remote: ReplicaOffer?,
    ): Pair<AdmissionSession, ReplicaOffer> {
        val keys = identityKeys(context)
        val deviceCert =
            DeviceCertificate(
                PomoSuite.ID,
                HpkeP256.serialize(keys.first.public),
                HpkeP256.serialize(keys.second.public),
            )
        val recoveryKeys = recoveryKeys(context)
        val recoveryCert =
            RecoveryCertificate(
                PomoSuite.ID,
                HpkeP256.serialize(recoveryKeys.first.public),
                HpkeP256.serialize(recoveryKeys.second.public),
            )
        val genesis =
            IdentityCodec.memberIdentity(
                MemberGenesis(PomoSuite.ID, PomoSuite.INITIAL_GENERATION, 1, recoveryCert, deviceCert),
            )
        val adoptedMember =
            if (remote != null) ProtocolBytes.of(unhex(remote.memberId), PomoSuite.ID_BYTES) else genesis.memberId
        val admissionId = ProtocolBytes.of(randomBytes(32), PomoSuite.ID_BYTES)
        val identityDeviceId = IdentityCodec.deviceId(deviceCert)
        val transcript = IdentityCodec.admissionTranscriptHash(adoptedMember, admissionId, deviceCert)
        val snapshot =
            AdmissionSnapshot(
                adoptedMember,
                admissionId,
                identityDeviceId,
                transcript,
                AdmissionStage.OFFER_CREATED,
            )
        val offer =
            ReplicaOffer(
                memberId = adoptedMember.toString(),
                admissionId = admissionId.toString(),
                identityDeviceId = identityDeviceId.toString(),
                lanDeviceId = ReplicaLanRuntime.lanDeviceId() ?: error("replica LAN session is required for admission"),
                transcriptHash = transcript.toString(),
                endpoint = ReplicaLanRuntime.httpEndpoint(),
            )
        return AdmissionSession.create(snapshot) to offer
    }

    private fun admitRemote(
        context: Context,
        session: AdmissionSession,
        remote: ReplicaOffer,
    ) {
        val local = session.snapshot()
        if (remote.memberId != local.memberId.toString()) {
            runCatching { session.blockDifferentMember() }
            return
        }
        val url = remote.endpoint
        if (url != null) {
            val parsed = java.net.URI(url)
            ReplicaLanRuntime.rememberPeer(
                ReplicaLanPeer(
                    remote.lanDeviceId,
                    parsed.host ?: error("replica offer host is required"),
                    if (parsed.port > 0) parsed.port else 80,
                    url,
                ),
            )
        }
    }

    private fun uiState(
        session: AdmissionSession,
        offer: String,
    ): SyncUiState {
        val snap = session.snapshot()
        val ready = snap.stage == AdmissionStage.READY_ACK_COMMITTED
        val blocked = snap.stage == AdmissionStage.IDENTITY_BLOCKED
        return SyncUiState.Dormant.copy(
            health =
                if (blocked) {
                    SyncHealth.STALLED
                } else if (ready) {
                    SyncHealth.OFFLINE
                } else {
                    SyncHealth.INCOMPLETE
                },
            summary =
                if (ready) {
                    "Device admitted"
                } else if (blocked) {
                    "Admission blocked"
                } else {
                    "Admission in progress"
                },
            detail =
                if (ready) {
                    "Saved locally. Exchange the offer with the other replica, then Retry now from Chrome to drain."
                } else {
                    "Saved locally. Compare fingerprints in person, then paste the other replica's offer."
                },
            admission =
                SyncWorkflow(
                    snap.stage.name,
                    "${snap.memberId}\n${snap.deviceId}",
                    snap.stage != AdmissionStage.IDENTITY_BLOCKED && snap.stage != AdmissionStage.READY_ACK_COMMITTED,
                ),
            admissionOffer = offer,
            signals =
                listOf(
                    com.pomo.sync.ui.SyncSignal("Saved locally", "Current", false),
                    com.pomo.sync.ui.SyncSignal("Peer-redundant", if (ready) "Paired" else "Not yet", false),
                    com.pomo.sync.ui.SyncSignal("Protected sync", if (ready) "Ready" else "Incomplete", !ready),
                    com.pomo.sync.ui.SyncSignal("Attention", if (ready) "None" else "Admission", !ready),
                ),
        )
    }

    private fun persist(
        context: Context,
        session: AdmissionSession,
        offer: ReplicaOffer,
    ) {
        val snap = session.snapshot()
        context.prefs().edit()
            .putString(
                SNAPSHOT_KEY,
                JSONObject()
                    .put("memberId", snap.memberId.toString())
                    .put("admissionId", snap.admissionId.toString())
                    .put("deviceId", snap.deviceId.toString())
                    .put("transcriptHash", snap.transcriptHash.toString())
                    .put("stage", snap.stage.name)
                    .toString(),
            )
            .putString(OFFER_KEY, offer.encode())
            .apply()
    }

    private fun loadSnapshot(context: Context): AdmissionSnapshot? {
        val raw = context.prefs().getString(SNAPSHOT_KEY, null) ?: return null
        return runCatching {
            val value = JSONObject(raw)
            AdmissionSnapshot(
                ProtocolBytes.of(unhex(value.getString("memberId")), PomoSuite.ID_BYTES),
                ProtocolBytes.of(unhex(value.getString("admissionId")), PomoSuite.ID_BYTES),
                ProtocolBytes.of(unhex(value.getString("deviceId")), PomoSuite.ID_BYTES),
                ProtocolBytes.of(unhex(value.getString("transcriptHash")), PomoSuite.ID_BYTES),
                AdmissionStage.valueOf(value.getString("stage")),
            )
        }.getOrNull()
    }

    private fun loadOffer(context: Context): ReplicaOffer? =
        context.prefs().getString(OFFER_KEY, null)?.let { runCatching { ReplicaOffer.decode(it) }.getOrNull() }

    private fun identityKeys(context: Context) =
        PlatformDeviceIdentityKeys(
            "replica-lan",
            File(File(context.filesDir, "sync").also { it.mkdirs() }, "replica-lan-agreement.bin"),
        ).loadOrCreate()

    private fun recoveryKeys(context: Context) =
        PlatformDeviceIdentityKeys(
            "replica-recovery",
            File(File(context.filesDir, "sync").also { it.mkdirs() }, "replica-recovery-agreement.bin"),
        ).loadOrCreate()

    private fun Context.prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun randomBytes(size: Int): ByteArray = ByteArray(size).also { SecureRandom().nextBytes(it) }

    private fun unhex(value: String): ByteArray {
        require(value.length == 64 && value.matches(Regex("[0-9a-f]+")))
        return ByteArray(32) { index -> value.substring(index * 2, index * 2 + 2).toInt(16).toByte() }
    }
}
