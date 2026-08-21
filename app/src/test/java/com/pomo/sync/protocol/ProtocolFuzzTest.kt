package com.pomo.sync.protocol

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

public class ProtocolFuzzTest {
    @Test
    public fun canonicalDecoderFailsClosedForDeterministicMutations() {
        val random = Random(0x504f4d4f)
        repeat(2_000) {
            val bytes = ByteArray(random.nextInt(0, 256)).also { random.nextBytes(it) }
            val result = runCatching { DeterministicCbor.decodeCanonical(bytes) }
            result.getOrNull()?.let { decoded ->
                assertTrue(DeterministicCbor.encode(decoded).contentEquals(bytes))
            }
        }
    }
}
