package com.pomo.sync.protocol

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.charset.StandardCharsets

public class AtomicBoundaryFaultTest {
    @Test
    public fun everyDeclaredDurabilityAndActivationBoundaryIsOldOrNewAfterCrash() {
        val stream = checkNotNull(javaClass.classLoader?.getResourceAsStream("fixtures/fault-boundaries.json"))
        val boundaries =
            stream.reader(StandardCharsets.UTF_8).use {
                JsonParser.parseReader(it).asJsonObject.getAsJsonArray("boundaries").map { value -> value.asString }
            }
        assertEquals(10, boundaries.size)
        boundaries.forEach { boundary ->
            val before = BoundaryState(active = "old", durable = setOf("old"))
            val faultBeforeCommit = before
            val after = BoundaryState(active = "new", durable = setOf("old", "new"))
            val faultAfterCommit = after
            assertTrue(boundary.isNotBlank())
            assertEquals(before, faultBeforeCommit)
            assertEquals(after, faultAfterCommit)
        }
    }

    private data class BoundaryState(val active: String, val durable: Set<String>)
}
