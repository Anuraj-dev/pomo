package com.pomo.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class PomoServiceAdvertiserTest {
    /**
     * A registration NsdManager accepted. It can still fail long after `register()`
     * returned, so the fake hands one of these back per accepted call and a test
     * drives the failure explicitly.
     */
    private class AcceptedRegistration(
        val port: Int,
        private val onFailed: () -> Unit,
    ) {
        fun failAsync() {
            onFailed()
        }
    }

    private class FakeRegistrar : NsdRegistrar {
        val calls: MutableList<String> = mutableListOf()
        val accepted: MutableList<AcceptedRegistration> = mutableListOf()
        var failNextRegister: Boolean = false

        override fun register(
            serviceName: String,
            serviceType: String,
            port: Int,
            onFailed: () -> Unit,
        ) {
            if (failNextRegister) {
                failNextRegister = false
                throw IllegalStateException("nsd unavailable")
            }
            calls.add("register:$serviceName:$serviceType:$port")
            accepted.add(AcceptedRegistration(port, onFailed))
        }

        override fun unregister() {
            calls.add("unregister")
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
        advertiser.advertise(9999)

        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister",
                "register:Pomo:_pomo._tcp:9999",
            ),
            registrar.calls,
        )
    }

    @Test
    public fun stop_unregistersOnlyWhenAdvertising() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)

        advertiser.stop()
        assertEquals(emptyList<String>(), registrar.calls)

        advertiser.advertise(9876)
        advertiser.stop()
        advertiser.stop()

        assertEquals(
            listOf("register:Pomo:_pomo._tcp:9876", "unregister"),
            registrar.calls,
        )
    }

    @Test
    public fun advertise_failureLeavesAdvertiserRetryable() {
        val registrar = FakeRegistrar()
        val advertiser = PomoServiceAdvertiser(registrar)
        registrar.failNextRegister = true

        advertiser.advertise(9876)
        advertiser.advertise(9876)

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

        // Re-registered, with no unregister in between: the failed registration
        // was never live, so there was nothing to tear down.
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
                "unregister",
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

        // The first registration fails only now, after its port was re-registered
        // by a different registration. Matching on the port alone would clear it.
        registrar.accepted[0].failAsync()

        assertTrue(advertiser.isAdvertising)

        advertiser.advertise(9876)

        assertEquals(
            listOf(
                "register:Pomo:_pomo._tcp:9876",
                "unregister",
                "register:Pomo:_pomo._tcp:9999",
                "unregister",
                "register:Pomo:_pomo._tcp:9876",
            ),
            registrar.calls,
        )
    }
}
