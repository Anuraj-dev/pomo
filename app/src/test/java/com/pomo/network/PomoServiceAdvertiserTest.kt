package com.pomo.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class PomoServiceAdvertiserTest {
    /**
     * Models NsdManager's two-phase contract: `register` accepts and returns, and the
     * registration only comes up or fails when a test says so. Teardown of a registration
     * that has not come up yet is refused, which is the case the advertiser has to survive
     * without leaking a record.
     */
    private class FakeRegistrar : NsdRegistrar {
        val calls: MutableList<String> = mutableListOf()
        val accepted: MutableList<FakeRegistration> = mutableListOf()
        var failNextRegister: Boolean = false

        /** Registrations that came up and were never torn down — the fake's mDNS records. */
        val published: List<FakeRegistration>
            get() = accepted.filter { it.isPublished }

        override fun register(
            serviceName: String,
            serviceType: String,
            port: Int,
            onRegistered: (NsdRegistrar.Registration) -> Unit,
            onFailed: (NsdRegistrar.Registration) -> Unit,
        ): NsdRegistrar.Registration {
            if (failNextRegister) {
                failNextRegister = false
                throw IllegalStateException("nsd unavailable")
            }
            calls.add("register:$serviceName:$serviceType:$port")
            val registration = FakeRegistration(port, onRegistered, onFailed)
            accepted.add(registration)
            return registration
        }

        inner class FakeRegistration(
            val port: Int,
            private val onRegistered: (NsdRegistrar.Registration) -> Unit,
            private val onFailed: (NsdRegistrar.Registration) -> Unit,
        ) : NsdRegistrar.Registration {
            private var cameUp: Boolean = false
            private var tornDown: Boolean = false

            /** True while the framework would still be answering queries for this record. */
            val isPublished: Boolean
                get() = cameUp && !tornDown

            override fun unregister() {
                calls.add("unregister:$port")
                if (!cameUp) {
                    throw IllegalArgumentException("listener not registered")
                }
                tornDown = true
            }

            /**
             * The framework reports the service came up. The record is live before the
             * callback runs, so a teardown driven from inside it succeeds.
             */
            fun comeUp() {
                cameUp = true
                onRegistered(this)
            }

            /** The framework reports the registration failed, after `register` returned. */
            fun failAsync() {
                onFailed(this)
            }
        }
    }

    @Test
    public fun advertise_registersOnce() {
        val registrar = FakeRegistrar()
        PomoServiceAdvertiser(registrar).advertise(9876)

        assertEquals(listOf("register:Pomo:_pomo._tcp:9876"), registrar.calls)
    }

    @Test
    public fun advertise_isIdempotentForSamePort() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.advertise(9876)
        advertiser.advertise(9876)
        advertiser.advertise(9876)

        assertEquals(listOf("register:Pomo:_pomo._tcp:9876"), registrar.calls)
    }

    @Test
    public fun advertise_reregistersWhenPortChanges() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.advertise(9876)
        registrar.accepted[0].comeUp()
        advertiser.advertise(9999)

        // Coming up as the live registration must not tear itself down.
        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister:9876",
                "register:Pomo:_pomo._tcp:9999",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun stop_unregistersTheLiveRegistrationOnce() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.stop()
        assertEquals(emptyList<String>(), registrar.calls)

        advertiser.advertise(9876)
        registrar.accepted[0].comeUp()
        advertiser.stop()
        assertFalse(advertiser.isAdvertising)

        // Nothing is live any more, so a second stop() must not poke a dead handle.
        advertiser.stop()

        assertEquals(
            listOf("register:Pomo:_pomo._tcp:9876", "unregister:9876"),
            registrar.calls,
        )
        assertTrue(registrar.published.isEmpty())
    }

    @Test
    public fun advertise_synchronousFailureLeavesAdvertiserRetryable() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)
        registrar.failNextRegister = true

        advertiser.advertise(9876)
        assertFalse(advertiser.isAdvertising)

        advertiser.advertise(9876)
        assertTrue(advertiser.isAdvertising)

        assertEquals(listOf("register:Pomo:_pomo._tcp:9876"), registrar.calls)
    }

    @Test
    public fun advertise_asyncFailureLeavesAdvertiserRetryable() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.advertise(9876)
        assertTrue(advertiser.isAdvertising)

        registrar.accepted[0].failAsync()
        assertFalse(advertiser.isAdvertising)

        advertiser.advertise(9876)
        assertTrue(advertiser.isAdvertising)

        // Re-registered with no unregister in between: the failed registration was never
        // live by the time it was retried, so there was nothing to tear down.
        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "register:Pomo:_pomo._tcp:9876",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun advertise_staleAsyncFailureDoesNotClearNewerRegistration() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.advertise(9876)
        advertiser.advertise(9999)

        assertEquals(9876, registrar.accepted[0].port)
        registrar.accepted[0].failAsync()

        assertTrue(advertiser.isAdvertising)

        // 9999 is still live, so re-advertising it must be a no-op.
        advertiser.advertise(9999)

        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister:9876",
                "register:Pomo:_pomo._tcp:9999",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun advertise_staleAsyncFailureDoesNotClearReregistrationOnSamePort() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.advertise(9876)
        advertiser.advertise(9999)
        advertiser.advertise(9876)

        // The first registration fails only now, after its port was re-registered by a
        // different registration. Matching on the port alone would clear the live one.
        registrar.accepted[0].failAsync()

        assertTrue(advertiser.isAdvertising)

        advertiser.advertise(9876)

        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister:9876",
                "register:Pomo:_pomo._tcp:9999",
                "unregister:9999",
                "register:Pomo:_pomo._tcp:9876",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun advertise_supersededPendingRegistrationIsTornDownWhenItComesUp() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        // 9876 is accepted but has not come up when the port changes, so the framework
        // refuses its teardown.
        advertiser.advertise(9876)
        advertiser.advertise(9999)

        // It comes up anyway, after it was already superseded.
        registrar.accepted[0].comeUp()

        assertTrue(registrar.published.isEmpty())
        assertTrue(advertiser.isAdvertising)
        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister:9876",
                "register:Pomo:_pomo._tcp:9999",
                "unregister:9876",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun stop_pendingRegistrationThatComesUpAfterwardsIsTornDown() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        // The service is destroyed while the registration is still coming up, so the
        // teardown is refused and nothing will call stop() again.
        advertiser.advertise(9876)
        advertiser.stop()
        assertFalse(advertiser.isAdvertising)

        registrar.accepted[0].comeUp()

        // Without the come-up teardown this record would answer queries for a dead port
        // until the process died.
        assertTrue(registrar.published.isEmpty())
        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister:9876",
                "unregister:9876",
            ),
            registrar.calls,
        )
    }
}
