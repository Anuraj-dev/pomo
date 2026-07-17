package com.pomo.profile

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Covers the migration rule only. The rest of [ProfileStore] writes through [com.pomo.crew.CrewStore],
 * whose Keystore-backed cipher has no Robolectric equivalent, so it is exercised on device.
 */
public class ProfileStoreTest {
    @Test
    public fun `a member who named themselves in a crew keeps that name`() {
        assertEquals("Asha", ProfileStore.inheritedName(listOf("Asha")))
    }

    @Test
    public fun `the first usable name wins when crews disagree`() {
        assertEquals("Asha", ProfileStore.inheritedName(listOf("   ", "Asha", "Bo")))
    }

    @Test
    public fun `a member who never named themselves starts empty`() {
        assertEquals("", ProfileStore.inheritedName(emptyList()))
        assertEquals("", ProfileStore.inheritedName(listOf("", "   ")))
    }

    @Test
    public fun `an inherited name is normalized`() {
        assertEquals("Asha", ProfileStore.inheritedName(listOf("  Asha  ")))
    }
}
