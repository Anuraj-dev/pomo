package com.pomo.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

/**
 * The NsdManager operations [PomoServiceAdvertiser] needs, behind an interface
 * so the registration state machine can be tested without the Android framework.
 */
public interface NsdRegistrar {
    public fun register(
        serviceName: String,
        serviceType: String,
        port: Int,
    )

    public fun unregister()
}

/**
 * Advertises the phone API over mDNS as `_pomo._tcp`, so LAN clients can find
 * the phone by name instead of a hardcoded IP that breaks on every DHCP lease
 * change.
 *
 * Advertising is optional, exactly like the phone API itself: registration
 * failures are logged and swallowed so a non-critical feature can never take
 * the timer down.
 *
 * Not thread-safe by itself. [PomodoroService] drives it from the service
 * lifecycle and its config-change path, both on the main thread.
 */
public class PomoServiceAdvertiser(
    private val registrar: NsdRegistrar,
) {
    private var advertisedPort: Int? = null

    public val isAdvertising: Boolean
        get() = advertisedPort != null

    /** Registers the service, or re-registers it if [port] differs from the live registration. */
    public fun advertise(port: Int) {
        if (advertisedPort == port) return
        if (advertisedPort != null) stop()

        try {
            registrar.register(SERVICE_NAME, SERVICE_TYPE, port)
            advertisedPort = port
            Log.d(TAG, "Advertising $SERVICE_NAME ($SERVICE_TYPE) on port $port")
        } catch (e: Exception) {
            // Leave advertisedPort null so a later call retries rather than
            // latching discovery off until the service restarts.
            advertisedPort = null
            Log.w(TAG, "mDNS registration failed on port $port: ${e.message}")
        }
    }

    public fun stop() {
        if (advertisedPort == null) return
        try {
            registrar.unregister()
        } catch (e: Exception) {
            Log.w(TAG, "mDNS unregistration failed: ${e.message}")
        }
        advertisedPort = null
    }

    private class NsdManagerRegistrar(
        private val nsdManager: NsdManager,
    ) : NsdRegistrar {
        private var listener: NsdManager.RegistrationListener? = null

        // NsdServiceInfo.setServiceName/setPort are deprecated on API 34+ in favour
        // of builder APIs that require API 34, while this project is minSdk 26.
        // Suppressed narrowly here rather than raising the API floor; remove once
        // minSdk reaches 34 and the builder APIs can be used unconditionally.
        @Suppress("DEPRECATION")
        override fun register(
            serviceName: String,
            serviceType: String,
            port: Int,
        ) {
            val info =
                NsdServiceInfo().apply {
                    this.serviceName = serviceName
                    this.serviceType = serviceType
                    this.port = port
                }
            val newListener =
                object : NsdManager.RegistrationListener {
                    override fun onServiceRegistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS registered as ${info.serviceName}")
                    }

                    override fun onRegistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        Log.w(TAG, "mDNS registration failed, code $errorCode")
                    }

                    override fun onServiceUnregistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS unregistered")
                    }

                    override fun onUnregistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        Log.w(TAG, "mDNS unregistration failed, code $errorCode")
                    }
                }
            // Retain the listener: unregisterService must be called with the
            // same instance that was passed to registerService, or NsdManager
            // throws and leaks the registration.
            listener = newListener
            nsdManager.registerService(info, NsdManager.PROTOCOL_DNS_SD, newListener)
        }

        override fun unregister() {
            val active = listener ?: return
            listener = null
            nsdManager.unregisterService(active)
        }
    }

    public companion object {
        public const val SERVICE_TYPE: String = "_pomo._tcp"
        public const val SERVICE_NAME: String = "Pomo"
        private const val TAG: String = "PomoAdvertiser"

        /** Builds an advertiser backed by the system NsdManager. */
        public fun forContext(context: Context): PomoServiceAdvertiser {
            val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            return PomoServiceAdvertiser(NsdManagerRegistrar(nsdManager))
        }
    }
}
