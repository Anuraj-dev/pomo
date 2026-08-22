package com.pomo.sync.transport

import android.content.Context
import com.pomo.sync.crypto.HpkeP256
import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.identity.PlatformDeviceIdentityKeys
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyPair

/**
 * Process-wide WebDAV mailbox drain routes. Endpoints are loaded from
 * `pomo_sync_mailbox` shared preferences when the host is allowed.
 */
internal object WebDavMailboxRuntime {
    private val lock = Any()
    private var routes: List<DrainRoute> = emptyList()

    data class Endpoint(
        val mailboxId: String,
        val baseUrl: String,
        val authorization: String,
        val peerDeviceIds: List<String>,
    )

    fun start(context: Context) {
        if (!OrdinaryDrainScheduler.hostAllowed()) return
        synchronized(lock) {
            if (routes.isNotEmpty()) return
            installLocked(context.applicationContext)
        }
    }

    /**
     * Starts mailbox routes when absent and configured. Returns true only when
     * this call created the routes so the caller can own cleanup.
     */
    fun ensureStarted(context: Context): Boolean {
        if (!OrdinaryDrainScheduler.hostAllowed()) return false
        synchronized(lock) {
            if (routes.isNotEmpty()) return false
            if (loadEndpoints(context.applicationContext).isEmpty()) return false
            installLocked(context.applicationContext)
            return routes.isNotEmpty()
        }
    }

    fun stop() {
        synchronized(lock) {
            routes = emptyList()
        }
    }

    fun drainRoutes(): List<DrainRoute> = synchronized(lock) { routes }

    fun installForTest(nextRoutes: List<DrainRoute>) {
        synchronized(lock) {
            routes = nextRoutes
        }
    }

    fun saveEndpoints(
        context: Context,
        endpoints: List<Endpoint>,
    ) {
        val array = JSONArray()
        endpoints.forEach { endpoint ->
            array.put(
                JSONObject()
                    .put("mailboxId", endpoint.mailboxId)
                    .put("baseUrl", endpoint.baseUrl)
                    .put("authorization", endpoint.authorization)
                    .put("peerDeviceIds", JSONArray(endpoint.peerDeviceIds)),
            )
        }
        context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY, array.toString())
            .apply()
    }

    private fun installLocked(context: Context) {
        val pair = signingPair(context)
        val publicKey = HpkeP256.serialize(pair.public)
        val localDeviceId = PomoCrypto.sha256(publicKey).joinToString("") { "%02x".format(it.toInt() and 0xff) }
        val endpoints = loadEndpoints(context)
        routes =
            endpoints.map { endpoint ->
                WebDavMailboxSession(
                    deviceId = localDeviceId,
                    publicKey = publicKey,
                    mailboxId = endpoint.mailboxId,
                    client = OkHttpWebDavClient(endpoint.baseUrl, endpoint.authorization),
                    peerDeviceIds = endpoint.peerDeviceIds,
                    sign = { PomoCrypto.signP256LowS(pair.private, it) },
                    ingest = ReplicaLanRuntime::ingestDisposition,
                ).drainRoute()
            }
    }

    private fun signingPair(context: Context): KeyPair {
        val dir = File(context.filesDir, "sync").also { it.mkdirs() }
        return PlatformDeviceIdentityKeys(
            "replica-lan",
            File(dir, "replica-lan-agreement.bin"),
        ).loadOrCreate().first
    }

    private fun loadEndpoints(context: Context): List<Endpoint> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            buildList {
                for (index in 0 until array.length()) {
                    val item = array.getJSONObject(index)
                    val peers = item.optJSONArray("peerDeviceIds") ?: JSONArray()
                    add(
                        Endpoint(
                            mailboxId = item.getString("mailboxId"),
                            baseUrl = item.getString("baseUrl"),
                            authorization = item.getString("authorization"),
                            peerDeviceIds =
                                buildList {
                                    for (peer in 0 until peers.length()) add(peers.getString(peer))
                                },
                        ),
                    )
                }
            }
        }.getOrDefault(emptyList())
    }

    private const val PREFS: String = "pomo_sync_mailbox"
    private const val KEY: String = "endpoints"
}
