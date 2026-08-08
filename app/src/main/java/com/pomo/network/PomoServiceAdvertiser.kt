package com.pomo.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
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
     * instance, and a superseded registration can still be in flight when the next one
     * starts.
     */
    public interface Registration {
        /**
         * Asks the framework to tear this registration down.
         *
         * May throw when the registration has not come up yet, and may fail
         * asynchronously. Callers must tolerate both.
         */
        public fun unregister()
    }

    /**
     * Starts registering the service and returns a handle to it.
     *
     * Registration is two-phase: an implementation accepts the request synchronously
     * and only learns the outcome afterwards, so a normal return is not success.
     * Neither callback may be invoked from inside this call.
     *
     * [onRegistered] means the service is now published and answering queries.
     * [onFailed] means it never came up and the handle is dead.
     */
    public fun register(
        serviceName: String,
        serviceType: String,
        port: Int,
        onRegistered: (Registration) -> Unit,
        onFailed: (Registration) -> Unit,
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
 * At most one registration is ever wanted, so at most one is tracked — [live]. The
 * complication is that a registration can be superseded or stopped while it is still
 * coming up, and a teardown asked for at that point may not take. Rather than track
 * which teardowns were refused and retry them, a registration that comes up when it is
 * no longer [live] tears itself down on the spot. That needs no retry bookkeeping and
 * holds whether or not the framework accepts a teardown of a pending registration —
 * which is not something this code can observe.
 *
 * Async registration failures schedule an indefinite fixed-interval retry via
 * [mainHandler] (null in unit tests = no auto-retry; callers may still call
 * [advertise] again). [stop] cancels pending retries.
 *
 * Not thread-safe by itself. There are three paths that mutate its state and all
 * of them must be the main thread: [PomodoroService] drives it from the service
 * lifecycle and from its config-change path, and [NsdManagerRegistrar] re-posts
 * NsdManager's registration callbacks — which the framework delivers on its own
 * internal thread — onto the main looper before they reach this class. Handing
 * this class a registrar that invokes callbacks off the main thread would break
 * that and require real synchronisation here.
 */
public class PomoServiceAdvertiser(
    private val registrar: NsdRegistrar,
    private val mainHandler: Handler? = null,
) {
    /** The registration [advertise] started last and has no reason to believe is down. */
    private class LiveRegistration(
        val port: Int,
        val registration: NsdRegistrar.Registration,
    )

    private var live: LiveRegistration? = null

    /** Last port [advertise] was asked to publish; used by async failure retries. */
    private var desiredPort: Int? = null

    private val retryRunnable: Runnable =
        Runnable {
            val port = desiredPort
            if (port == null) return@Runnable
            if (live != null) return@Runnable
            Log.d(TAG, "mDNS registration retry on port $port")
            advertiseInternal(port)
        }

    public val isAdvertising: Boolean
        get() = live != null

    /** Registers the service, or re-registers it if [port] differs from the live registration. */
    public fun advertise(port: Int) {
        desiredPort = port
        if (live?.port == port) return
        cancelRetry()
        // Do not call [stop] — it clears [desiredPort]. Tear down prior live only.
        stopKeepingDesired()
        advertiseInternal(port)
    }

    public fun stop() {
        desiredPort = null
        cancelRetry()
        stopKeepingDesired()
    }

    private fun stopKeepingDesired() {
        val current = live ?: return
        live = null
        tearDown(current.registration)
    }

    private fun advertiseInternal(port: Int) {
        try {
            val registration =
                registrar.register(
                    serviceName = SERVICE_NAME,
                    serviceType = SERVICE_TYPE,
                    port = port,
                    onRegistered = { registered ->
                        // Coming up while no longer live means this registration was
                        // superseded or stopped while it was still pending, so the
                        // teardown asked for back then could not take. Take it down now,
                        // or it answers queries for a port nothing is listening on until
                        // the process dies.
                        if (live?.registration !== registered) {
                            Log.d(TAG, "Tearing down a superseded registration on port $port")
                            tearDown(registered)
                        } else {
                            cancelRetry()
                        }
                    },
                    onFailed = { failed ->
                        // The failure is reported after register() returned, so a later
                        // advertise() may already have superseded this registration.
                        // Identity settles that without a generation counter, and unlike
                        // a port comparison it cannot confuse a newer registration that
                        // happens to use the same port.
                        if (live?.registration === failed) {
                            live = null
                            Log.w(TAG, "mDNS registration failed asynchronously on port $port")
                            scheduleRetry()
                        }
                    },
                )
            live = LiveRegistration(port, registration)
            Log.d(TAG, "Advertising $SERVICE_NAME ($SERVICE_TYPE) on port $port")
        } catch (e: Exception) {
            // Leave live null so a later call retries rather than latching discovery
            // off until the service restarts.
            live = null
            Log.w(TAG, "mDNS registration failed on port $port: ${e.message}")
            scheduleRetry()
        }
    }

    private fun scheduleRetry() {
        val handler = mainHandler ?: return
        if (desiredPort == null) return
        handler.removeCallbacks(retryRunnable)
        handler.postDelayed(retryRunnable, RETRY_INTERVAL_MS)
        Log.d(TAG, "mDNS registration scheduled retry in ${RETRY_INTERVAL_MS}ms")
    }

    private fun cancelRetry() {
        mainHandler?.removeCallbacks(retryRunnable)
    }

    private fun tearDown(registration: NsdRegistrar.Registration) {
        try {
            registration.unregister()
        } catch (e: Exception) {
            // Refused because the registration had not come up yet. onRegistered takes
            // it down when it does.
            Log.w(TAG, "mDNS unregistration refused: ${e.message}")
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
            onRegistered: (NsdRegistrar.Registration) -> Unit,
            onFailed: (NsdRegistrar.Registration) -> Unit,
        ): NsdRegistrar.Registration {
            val serviceInfo =
                NsdServiceInfo().apply {
                    this.serviceName = serviceName
                    this.serviceType = serviceType
                    this.port = port
                }
            // NsdManager invokes listener callbacks on its own internal thread, while
            // PomoServiceAdvertiser's state is main-thread-only — so every callback
            // that reaches the advertiser is re-posted onto the main looper first.
            val mainHandler = Handler(Looper.getMainLooper())
            // The listener is the handle: unregisterService must be called with the
            // same instance that was passed to registerService.
            val registration =
                object : NsdRegistrar.Registration, NsdManager.RegistrationListener {
                    override fun unregister() {
                        nsdManager.unregisterService(this)
                    }

                    override fun onServiceRegistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS registered as ${info.serviceName}")
                        mainHandler.post { onRegistered(this) }
                    }

                    override fun onRegistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        Log.w(TAG, "mDNS registration failed, code $errorCode")
                        mainHandler.post { onFailed(this) }
                    }

                    override fun onServiceUnregistered(info: NsdServiceInfo) {
                        Log.d(TAG, "mDNS unregistered")
                    }

                    override fun onUnregistrationFailed(
                        info: NsdServiceInfo,
                        errorCode: Int,
                    ) {
                        // Terminal: NsdManager drops the listener before reporting this,
                        // so the handle is dead and asking again cannot help. The record
                        // may outlive us, which is why nothing here retries.
                        Log.w(TAG, "mDNS unregistration failed, code $errorCode")
                    }
                }
            nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registration)
            return registration
        }
    }

    public companion object {
        public const val SERVICE_TYPE: String = "_pomo._tcp"
        public const val SERVICE_NAME: String = "Pomo"
        private const val TAG: String = "PomoAdvertiser"

        /** Keep retrying while the foreground service wants this port advertised. */
        private const val RETRY_INTERVAL_MS: Long = 5_000L

        /** Builds an advertiser backed by the system NsdManager. */
        public fun forContext(context: Context): PomoServiceAdvertiser {
            val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
            return PomoServiceAdvertiser(
                registrar = NsdManagerRegistrar(nsdManager),
                mainHandler = Handler(Looper.getMainLooper()),
            )
        }
    }
}
