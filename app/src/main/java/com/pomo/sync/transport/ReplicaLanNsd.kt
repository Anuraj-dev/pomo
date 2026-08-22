package com.pomo.sync.transport

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import android.util.Log

internal class ReplicaLanAdvertiser(
    private val nsdManager: NsdManager,
) {
    @Volatile
    private var listener: NsdManager.RegistrationListener? = null

    @Suppress("DEPRECATION")
    fun advertise(
        deviceId: String,
        port: Int,
    ) {
        stop()
        val serviceInfo =
            NsdServiceInfo().apply {
                serviceName = serviceName(deviceId)
                serviceType = SERVICE_TYPE
                this.port = port
                setAttribute(DEVICE_ATTRIBUTE, deviceId)
            }
        val mainHandler = Handler(Looper.getMainLooper())
        val registration =
            object : NsdManager.RegistrationListener {
                override fun onServiceRegistered(info: NsdServiceInfo) = Unit

                override fun onRegistrationFailed(
                    info: NsdServiceInfo,
                    errorCode: Int,
                ) {
                    Log.w(TAG, "replica mDNS registration failed, code $errorCode")
                    mainHandler.post {
                        if (listener === this) listener = null
                    }
                }

                override fun onServiceUnregistered(info: NsdServiceInfo) = Unit

                override fun onUnregistrationFailed(
                    info: NsdServiceInfo,
                    errorCode: Int,
                ) {
                    Log.w(TAG, "replica mDNS unregistration failed, code $errorCode")
                }
            }
        listener = registration
        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registration)
    }

    fun stop() {
        val registration = listener
        listener = null
        if (registration != null) {
            runCatching { nsdManager.unregisterService(registration) }
        }
    }

    companion object {
        const val SERVICE_TYPE: String = "_pomo-replica._tcp"
        const val DEVICE_ATTRIBUTE: String = "id"
        private const val TAG: String = "ReplicaLanNsd"

        fun serviceName(deviceId: String): String = "pomo-${deviceId.take(8)}"

        fun forContext(context: Context): ReplicaLanAdvertiser {
            val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            return ReplicaLanAdvertiser(nsdManager)
        }
    }
}

internal class ReplicaLanBrowser(
    private val nsdManager: NsdManager,
    private val localDeviceId: String,
    private val onPeers: (List<ReplicaLanPeer>) -> Unit,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val discovered = linkedMapOf<String, ReplicaLanPeer>()
    private var listener: NsdManager.DiscoveryListener? = null

    @Suppress("DEPRECATION")
    fun start() {
        if (listener != null) return
        val discovery =
            object : NsdManager.DiscoveryListener {
                override fun onDiscoveryStarted(serviceType: String) = Unit

                override fun onDiscoveryStopped(serviceType: String) = Unit

                override fun onStartDiscoveryFailed(
                    serviceType: String,
                    errorCode: Int,
                ) {
                    Log.w(TAG, "replica discovery failed to start, code $errorCode")
                }

                override fun onStopDiscoveryFailed(
                    serviceType: String,
                    errorCode: Int,
                ) = Unit

                override fun onServiceFound(service: NsdServiceInfo) {
                    if (service.serviceType != ReplicaLanAdvertiser.SERVICE_TYPE &&
                        service.serviceType != "${ReplicaLanAdvertiser.SERVICE_TYPE}."
                    ) {
                        return
                    }
                    nsdManager.resolveService(
                        service,
                        object : NsdManager.ResolveListener {
                            override fun onResolveFailed(
                                info: NsdServiceInfo,
                                errorCode: Int,
                            ) = Unit

                            override fun onServiceResolved(info: NsdServiceInfo) {
                                val peer = peerFrom(info) ?: return
                                if (peer.deviceId == localDeviceId) return
                                mainHandler.post {
                                    discovered[peer.deviceId] = peer
                                    onPeers(discovered.values.toList())
                                }
                            }
                        },
                    )
                }

                override fun onServiceLost(service: NsdServiceInfo) {
                    val deviceId = deviceIdOf(service) ?: return
                    mainHandler.post {
                        discovered.remove(deviceId)
                        onPeers(discovered.values.toList())
                    }
                }
            }
        listener = discovery
        nsdManager.discoverServices(ReplicaLanAdvertiser.SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
    }

    fun stop() {
        val discovery = listener
        listener = null
        if (discovery != null) {
            runCatching { nsdManager.stopServiceDiscovery(discovery) }
        }
        mainHandler.post {
            discovered.clear()
            onPeers(emptyList())
        }
    }

    companion object {
        private const val TAG: String = "ReplicaLanNsd"

        fun forContext(
            context: Context,
            localDeviceId: String,
            onPeers: (List<ReplicaLanPeer>) -> Unit,
        ): ReplicaLanBrowser {
            val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            return ReplicaLanBrowser(nsdManager, localDeviceId, onPeers)
        }

        @Suppress("DEPRECATION")
        fun peerFrom(info: NsdServiceInfo): ReplicaLanPeer? {
            val host = info.host?.hostAddress ?: return null
            val deviceId = deviceIdOf(info) ?: return null
            if (info.port <= 0) return null
            return ReplicaLanPeer(deviceId, host, info.port)
        }

        fun deviceIdOf(info: NsdServiceInfo): String? {
            val raw = info.attributes[ReplicaLanAdvertiser.DEVICE_ATTRIBUTE] ?: return null
            val value = raw.toString(Charsets.UTF_8).trim { it <= ' ' || it == '\u0000' }
            return value.takeIf { it.length == 64 }
        }
    }
}
