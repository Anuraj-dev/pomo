package com.pomo.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class PomoServiceAdvertiserTest {
    /**
     * Models NsdManager's two-phase contract: `register` accepts and returns, and the
     * registration only comes up, fails, or goes away when a test says so. Teardown of a
     * registration that has not come up yet is rejected, exactly as NsdManager rejects
     * `unregisterService` for a listener whose registration never completed.
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
            onFailed: (NsdRegistrar.Registration) -> Unit,
            onUnregistered: (NsdRegistrar.Registration) -> Unit,
        ): NsdRegistrar.Registration {
            if (failNextRegister) {
                failNextRegister = false
                throw IllegalStateException("nsd unavailable")
            }
            calls.add("register:$serviceName:$serviceType:$port")
            val registration = FakeRegistration(port, onFailed, onUnregistered)
            accepted.add(registration)
            return registration
        }

        inner class FakeRegistration(
            val port: Int,
            private val onFailed: (NsdRegistrar.Registration) -> Unit,
            private val onUnregistered: (NsdRegistrar.Registration) -> Unit,
        ) : NsdRegistrar.Registration {
            private var cameUp: Boolean = false
            private var teardownAccepted: Boolean = false

            /** True while the framework would still be answering queries for this record. */
            val isPublished: Boolean
                get() = cameUp && !teardownAccepted

            override fun unregister() {
                calls.add("unregister:$port")
                if (!cameUp) {
                    throw IllegalArgumentException("listener not registered")
                }
                teardownAccepted = true
            }

            /** The framework reports the service came up. */
            fun comeUp() {
                cameUp = true
            }

            /** The framework reports the registration failed, after `register` returned. */
            fun failAsync() {
                onFailed(this)
            }

            /** The framework confirms the teardown. */
            fun confirmUnregistered() {
                onUnregistered(this)
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
    public fun stop_unregistersOnlyWhatIsOutstanding() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.stop()
        assertEquals(emptyList<String>(), registrar.calls)

        advertiser.advertise(9876)
        registrar.accepted[0].comeUp()
        advertiser.stop()
        assertFalse(advertiser.isAdvertising)

        // Once the framework confirms the teardown the handle is gone, so a second
        // stop() has nothing left to take down.
        registrar.accepted[0].confirmUnregistered()
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

        registrar.accepted[1].comeUp()
        advertiser.stop()

        // Re-registered with no unregister in between: the failed registration was never
        // live, so there was nothing to tear down. It is also dropped, so the later stop()
        // does not try to unregister it.
        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "register:Pomo:_pomo._tcp:9876",
                "unregister:9876",
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
                // Neither earlier registration had come up, so both teardowns are
                // rejected and both handles are kept.
                "unregister:9876",
                "unregister:9999",
                "register:Pomo:_pomo._tcp:9876",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun advertise_supersededPendingRegistrationThatComesUpIsStillTornDown() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        // 9876 is accepted but has not come up when the port changes, so the framework
        // rejects its teardown.
        advertiser.advertise(9876)
        advertiser.advertise(9999)

        val first = registrar.accepted[0]
        val second = registrar.accepted[1]

        // Both come up afterwards, including the one that was already cancelled.
        first.comeUp()
        second.comeUp()
        assertEquals(listOf(first, second), registrar.published)

        advertiser.stop()

        // The superseded registration was still reachable, so nothing is left published.
        assertTrue(registrar.published.isEmpty())
        assertFalse(advertiser.isAdvertising)
        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister:9876",
                "register:Pomo:_pomo._tcp:9999",
                "unregister:9876",
                "unregister:9999",
            ),
            registrar.calls,
        )
    }
}
