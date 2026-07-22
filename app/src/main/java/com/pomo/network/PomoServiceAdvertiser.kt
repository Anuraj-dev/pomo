package com.pomo.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log

/**
 * The NsdManager operations [PomoServiceAdvertiser] needs, behind an interface so the
 * registration lifecycle can be tested without the Android framework.
 */
public interface NsdRegistrar {
    /**
     * A handle to one registration the framework has accepted.
     *
     * Registrations are handed back individually because NsdManager identifies one by
     * the listener instance it was given: tearing a registration down needs that exact
     * instance, and there may be more than one in flight at a time.
     */
    public interface Registration {
        /**
         * Asks the framework to tear this registration down.
         *
         * Throws when the registration has not finished coming up yet — NsdManager
         * rejects `unregisterService` for a listener whose registration never
         * completed — so callers must tolerate that and keep the handle.
         */
        public fun unregister()
    }

    /**
     * Starts registering the service and returns a handle to it.
     *
     * Registration is two-phase: an implementation accepts the request synchronously
     * and may only learn the outcome afterwards, so a normal return is not success.
     * Neither callback may be invoked from inside this call.
     *
     * Both callbacks are terminal — once either fires the framework is finished with
     * that handle and it can be dropped. [onFailed] means the registration never came
     * up, [onUnregistered] that it was torn down.
     */
    public fun register(
        serviceName: String,
        serviceType: String,
        port: Int,
        onFailed: (Registration) -> Unit,
        onUnregistered: (Registration) -> Unit,
    ): Registration
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
 * Nothing here tries to decide which registration is "the current one" inside the
 * registrar. Every handle the framework has accepted and not yet reported as
 * finished is kept in [outstanding], and each one removes itself when its terminal
 * callback arrives; [stop] tears down all of them. That is what makes a registration
 * cancelled while still pending recoverable: the framework rejects the teardown, the
 * handle stays, and the next [stop] tries again.
 *
 * Not thread-safe by itself. There are three paths that mutate its state and all
 * of them are the main thread: [PomodoroService] drives it from the service
 * lifecycle and from its config-change path, and NsdManager delivers registration
 * callbacks on the main looper for the three-argument `registerService` overload.
 * Handing the registrar an NsdManager driven off a different looper (or the API 31+
 * executor overload) would break that and require real synchronisation here.
 */
public class PomoServiceAdvertiser(
    private val registrar: NsdRegistrar,
) {
    /** The registration [advertise] started last and has no reason to believe is down. */
    private class LiveRegistration(
        val port: Int,
        val registration: NsdRegistrar.Registration,
    )

    /** Every handle the framework has accepted and not yet reported as finished with. */
    private val outstanding = mutableListOf<NsdRegistrar.Registration>()

    private var live: LiveRegistration? = null

    public val isAdvertising: Boolean
        get() = live != null

    /** Registers the service, or re-registers it if [port] differs from the live registration. */
    public fun advertise(port: Int) {
        if (live?.port == port) return
        stop()
        try {
            val registration =
                registrar.register(
                    serviceName = SERVICE_NAME,
                    serviceType = SERVICE_TYPE,
                    port = port,
                    onFailed = { failed ->
                        outstanding.remove(failed)
                        // The failure is reported after register() returned, so a later
                        // advertise() may already have superseded this registration.
                        // Only the live one clears the port; identity settles that
                        // without a generation counter, and the same port being
                        // re-registered by a newer attempt cannot be confused for it.
                        if (live?.registration === failed) {
                            live = null
                            Log.w(TAG, "mDNS registration failed asynchronously on port $port")
                        }
                    },
                    onUnregistered = { gone -> outstanding.remove(gone) },
                )
            outstanding.add(registration)
            live = LiveRegistration(port, registration)
            Log.d(TAG, "Advertising $SERVICE_NAME ($SERVICE_TYPE) on port $port")
        } catch (e: Exception) {
            // Leave live null so a later call retries rather than latching discovery
            // off until the service restarts.
            Log.w(TAG, "mDNS registration failed on port $port: ${e.message}")
        }
    }

    public fun stop() {
        live = null
        // Tear down everything still outstanding, not just the live one: a registration
        // that was superseded while still pending had its teardown rejected and is still
        // held here, and this is the only handle that can ever take it down. Each attempt
        // is wrapped on its own so one rejection cannot skip the rest.
        for (registration in outstanding.toList()) {
            try {
                registration.unregister()
            } catch (e: Exception) {
                Log.w(TAG, "mDNS unregistration failed: ${e.message}")
            }
        }
    }

    private class NsdManagerRegistrar(
        private val nsdManager: NsdManager,
    ) : NsdRegistrar {
        // NsdServiceInfo.setServiceName/setPort are deprecated on API 34+ in favour
        // of builder APIs that require API 34, while this project is minSdk 26.
        // Suppressed narrowly here rather than raising the API floor; remove once
        // minSdk reaches 34 and the builder APIs can be used unconditionally.
        @Suppress("DEPRECATION")
        override fun register(
            serviceName: String,
            serviceType: String,
            port: Int,
            onFailed: (NsdRegistrar.Registration) -> Unit,
            onUnregistered: (NsdRegistrar.Registration) -> Unit,
        ): NsdRegistrar.Registration {
            val serviceInfo =
                NsdServiceInfo().apply {
                    this.serviceName = serviceName
                    this.serviceType = serviceType
                    this.port = port
                }
            // The listener is the handle: unregisterService must be called with the
            // same instance that was passed to registerService.
            val registration =
                object : NsdRegistrar.Registration, NsdManager.RegistrationListener {
                    override fun unregister() {
                        nsdManager.unregisterService(this)
                    }

                    override fun onServiceRegistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS registered as ${info.serviceName}")
                    }

                    override fun onRegistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        Log.w(TAG, "mDNS registration failed, code $errorCode")
                        onFailed(this)
                    }

                    override fun onServiceUnregistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS unregistered")
                        onUnregistered(this)
                    }

                    override fun onUnregistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        // Not terminal: the advertiser keeps the handle, so the next
                        // stop() or port change takes another run at it.
                        Log.w(TAG, "mDNS unregistration failed, code $errorCode")
                    }
                }
            // Added to the caller's outstanding set only once the framework has taken
            // it, so a synchronous throw here retains nothing.
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registration)
            return registration
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
