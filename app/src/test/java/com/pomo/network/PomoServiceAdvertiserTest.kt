package com.pomo.network

import org.junit.Assert.assertEquals
import org.junit.Test

public class PomoServiceAdvertiserTest {
    private class FakeRegistrar : NsdRegistrar {
        val calls: MutableList<String> = mutableListOf()
        var failNextRegister: Boolean = false

        override fun register(
            serviceName: String,
            serviceType: String,
            port: Int,
        ) {
            if (failNextRegister) {
                failNextRegister = false
                throw IllegalStateException("nsd unavailable")
            }
            calls.add("register:$serviceName:$serviceType:$port")
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
}
