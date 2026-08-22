package com.pomo.sync.transport

import android.content.Context
import com.pomo.db.AppDatabase
import com.pomo.sync.crypto.CoseKernelSigner
import com.pomo.sync.crypto.CoseKernelVerifier
import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.identity.PlatformDeviceIdentityKeys
import com.pomo.sync.persistence.RoomOperationStore
import com.pomo.sync.protocol.CheckpointVerifier
import com.pomo.sync.protocol.OperationKernel
import java.io.File
import java.security.KeyPair
import java.security.PublicKey
import java.util.concurrent.ConcurrentHashMap

/**
 * Process-wide replica LAN session. Drain routes are the currently resolved
 * LAN peers. Ingress is [OperationKernel.ingest].
 */
internal object ReplicaLanRuntime {
    private val lock = Any()
    private var session: ReplicaLanSession? = null
    private var kernel: OperationKernel? = null
    private var listener: ReplicaLanListener? = null
    private var advertiser: ReplicaLanAdvertiser? = null
    private var browser: ReplicaLanBrowser? = null
    private val peers = linkedMapOf<String, ReplicaLanPeer>()
    private val keys = ConcurrentHashMap<String, PublicKey>()

    fun start(context: Context) {
        if (!OrdinaryDrainScheduler.hostAllowed()) return
        synchronized(lock) {
            if (session != null) return
            startLocked(context)
        }
    }

    /**
     * Starts the runtime when absent. Returns true only when this call created
     * the session so the caller can own cleanup.
     */
    fun ensureStarted(context: Context): Boolean {
        if (!OrdinaryDrainScheduler.hostAllowed()) return false
        synchronized(lock) {
            if (session != null) return false
            startLocked(context)
            return true
        }
    }

    fun stop() {
        synchronized(lock) {
            clearLocked()
        }
    }

    fun drainRoutes(): List<DrainRoute> {
        val local =
            synchronized(lock) {
                session to peers.values.toList()
            }
        val current = local.first ?: return emptyList()
        return local.second
            .filter { it.deviceId != current.deviceId }
            .map { peer ->
                current.drainRoute(peer.deviceId) { request -> ReplicaLanListener.exchange(peer, request) }
            }
    }

    fun ingest(wire: ByteArray) {
        ingestDisposition(wire)
    }

    fun ingestDisposition(wire: ByteArray): String {
        val current = synchronized(lock) { kernel }
        return current?.ingest(wire.copyOf())?.name ?: "REJECTED_INVALID"
    }

    fun installForTest(
        nextSession: ReplicaLanSession,
        nextKernel: OperationKernel?,
        nextPeers: List<ReplicaLanPeer>,
        nextKeys: Map<String, PublicKey> = emptyMap(),
    ) {
        synchronized(lock) {
            session = nextSession
            kernel = nextKernel
            peers.clear()
            nextPeers.forEach { peers[it.deviceId] = it }
            keys.clear()
            keys.putAll(nextKeys)
        }
    }

    fun registerPublicKey(
        deviceId: String,
        publicKey: PublicKey,
    ) {
        keys[deviceId] = publicKey
    }

    private fun startLocked(context: Context) {
        try {
            val app = context.applicationContext
            val pair = persistedSigningPair(app)
            val publicKey = HpkeP256.serialize(pair.public)
            val deviceId = PomoCrypto.sha256(publicKey).joinToString("") { "%02x".format(it.toInt() and 0xff) }
            keys[deviceId] = pair.public
            val store = RoomOperationStore(AppDatabase.getInstance(app))
            val nextKernel =
                OperationKernel(
                    CoseKernelSigner(pair.private),
                    CoseKernelVerifier { id -> keys[id.toString()] },
                    store,
                    CheckpointVerifier { },
                )
            kernel = nextKernel
            val nextSession =
                ReplicaLanSession(
                    deviceId,
                    publicKey,
                    sign = { PomoCrypto.signP256LowS(pair.private, it) },
                    ingest = { wire -> nextKernel.ingest(wire).name },
                    outbox = { OrdinaryDrainHost.envelopesFrom(store.restartSnapshot()) },
                )
            session = nextSession
            val nextListener = ReplicaLanListener(nextSession)
            listener = nextListener
            val port = nextListener.start()
            val nextAdvertiser = ReplicaLanAdvertiser.forContext(app)
            advertiser = nextAdvertiser
            nextAdvertiser.advertise(deviceId, port)
            val nextBrowser = ReplicaLanBrowser.forContext(app, deviceId, ::replacePeers)
            browser = nextBrowser
            nextBrowser.start()
        } catch (error: Exception) {
            clearLocked()
            throw error
        }
    }

    private fun clearLocked() {
        browser?.stop()
        advertiser?.stop()
        listener?.stop()
        browser = null
        advertiser = null
        listener = null
        session = null
        kernel = null
        peers.clear()
        keys.clear()
    }

    private fun replacePeers(next: List<ReplicaLanPeer>) {
        synchronized(lock) {
            peers.clear()
            next.forEach { peers[it.deviceId] = it }
        }
    }

    private fun persistedSigningPair(context: Context): KeyPair {
        val dir = File(context.filesDir, "sync").also { it.mkdirs() }
        return PlatformDeviceIdentityKeys(
            "replica-lan",
            File(dir, "replica-lan-agreement.bin"),
        ).loadOrCreate().first
    }
}
