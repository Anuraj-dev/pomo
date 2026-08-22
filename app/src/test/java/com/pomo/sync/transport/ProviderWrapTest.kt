package com.pomo.sync.transport

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class ProviderWrapTest {
    @Test
    public fun wrapRoundTripsUnderInstalledContentKey() {
        val key = ByteArray(32) { 9 }
        ProviderWrap.installContentKey(key)
        try {
            assertTrue(ProviderWrap.installed())
            val plain = byteArrayOf(1, 2, 3, 4)
            val wrapped = ProviderWrap.wrap(plain)
            assertTrue(wrapped.size > plain.size)
            assertArrayEquals(plain, ProviderWrap.open(wrapped))
        } finally {
            ProviderWrap.installContentKey(null)
            assertFalse(ProviderWrap.installed())
        }
    }

    @Test
    public fun passthroughWithoutContentKey() {
        ProviderWrap.installContentKey(null)
        val plain = byteArrayOf(5, 6)
        assertArrayEquals(plain, ProviderWrap.wrap(plain))
        assertArrayEquals(plain, ProviderWrap.open(plain))
    }
}
