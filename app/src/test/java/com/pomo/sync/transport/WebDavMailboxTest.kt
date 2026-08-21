package com.pomo.sync.transport

import com.pomo.sync.crypto.PomoCrypto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class WebDavMailboxTest {
    @Test
    public fun protectionRequiresImmutableCreateThenRetrievalVerification() {
        val client = MemoryMailbox()
        val bytes = byteArrayOf(1, 2, 3)
        val expected = MailboxObject("object", bytes, PomoCrypto.sha256(bytes).hex(), bytes.size.toLong())
        assertTrue(WebDavMailbox("primary", client).protect(listOf(expected)).protected)
        client.objects[expected.objectId] = byteArrayOf(9)
        assertFalse(WebDavMailbox("primary", client).challenge(expected))
    }

    @Test
    public fun oneMailboxFailureDoesNotDowngradeAnotherAndRepairNeverDeletes() {
        val source = MemoryMailbox(mutableMapOf("a" to byteArrayOf(1), "b" to byteArrayOf(2)))
        val target = MemoryMailbox()
        assertEquals(setOf("a", "b"), repairMailbox(source, target, listOf("a", "missing", "b")))
        assertEquals(setOf("a", "b"), target.objects.keys)
    }

    private class MemoryMailbox(val objects: MutableMap<String, ByteArray> = linkedMapOf()) : ImmutableMailboxClient {
        override fun createIfAbsent(
            objectId: String,
            bytes: ByteArray,
        ): Boolean {
            if (objectId in objects) return false
            objects[objectId] = bytes.copyOf()
            return true
        }

        override fun get(objectId: String): ByteArray? = objects[objectId]?.copyOf()
    }

    private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}
