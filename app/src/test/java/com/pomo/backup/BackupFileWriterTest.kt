package com.pomo.backup

import java.io.ByteArrayOutputStream
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

public class BackupFileWriterTest {
    @Test
    public fun `uses the provider compatible write mode and writes non empty content`() {
        val output = ByteArrayOutputStream()
        var requestedMode: String? = null

        val written =
            BackupFileWriter.write(
                openOutputStream = { mode ->
                    requestedMode = mode
                    if (mode == "wt") throw IOException("provider rejects truncate mode")
                    output
                },
                json = "{}",
            )

        assertTrue(written)
        assertEquals("w", requestedMode)
        assertTrue(output.size() > 0)
    }
}
