package com.pomo.profile

import org.junit.Assert.assertEquals
import org.junit.Test

public class KeyFingerprintTest {
    @Test
    public fun `formats the first eight hex characters as two groups`() {
        assertEquals("4f2a · 9c11", KeyFingerprint.format("4f2a9c11" + "ab".repeat(28)))
    }

    @Test
    public fun `normalizes case and surrounding space`() {
        assertEquals("4f2a · 9c11", KeyFingerprint.format("  4F2A9C11${"AB".repeat(28)}  "))
    }

    @Test
    public fun `is empty when there is no usable key`() {
        assertEquals("", KeyFingerprint.format(""))
        assertEquals("", KeyFingerprint.format("4f2a"))
        assertEquals("", KeyFingerprint.format("not-hex-at-all"))
    }
}
