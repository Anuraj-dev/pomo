package com.pomo.sync.transport

import android.content.Context
import com.pomo.db.AppDatabase
import com.pomo.sync.crypto.CoseKernelSigner
import com.pomo.sync.crypto.CoseKernelVerifier
import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.persistence.RoomOperationStore
import com.pomo.sync.protocol.CheckpointVerifier
import com.pomo.sync.protocol.OperationKernel
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.security.spec.ECGenParameterSpec

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
    private val keys = linkedMapOf<String, PublicKey>()

    fun start(context: Context) {
        if (!OrdinaryDrainScheduler.hostAllowed()) return
        synchronized(lock) {
            if (session != null) return
            val pair = signingPair()
            val publicKey = HpkeP256.serialize(pair.public)
            val deviceId = PomoCrypto.sha256(publicKey).joinToString("") { "%02x".format(it.toInt() and 0xff) }
            keys[deviceId] = pair.public
            val store = RoomOperationStore(AppDatabase.getInstance(context.applicationContext))
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
            val nextAdvertiser = ReplicaLanAdvertiser.forContext(context)
            advertiser = nextAdvertiser
            nextAdvertiser.advertise(deviceId, port)
            val nextBrowser = ReplicaLanBrowser.forContext(context, deviceId, ::replacePeers)
            browser = nextBrowser
            nextBrowser.start()
        }
    }

    fun stop() {
        synchronized(lock) {
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
        val current = synchronized(lock) { kernel }
        current?.ingest(wire.copyOf())
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
        synchronized(lock) { keys[deviceId] = publicKey }
    }

    private fun replacePeers(next: List<ReplicaLanPeer>) {
        synchronized(lock) {
            peers.clear()
            next.forEach { peers[it.deviceId] = it }
        }
    }

    private fun signingPair(): KeyPair =
        KeyPairGenerator.getInstance("EC").run {
            initialize(ECGenParameterSpec("secp256r1"))
            generateKeyPair()
        }
}
