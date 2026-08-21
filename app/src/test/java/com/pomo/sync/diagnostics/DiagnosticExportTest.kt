package com.pomo.sync.diagnostics

import java.io.ByteArrayOutputStream
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

public class DiagnosticExportTest {
    @Test
    public fun aliasesReferencesAndNeverExportsStableIds() {
        val output = ByteArrayOutputStream()
        DiagnosticExporter.export(
            sequenceOf(
                DiagnosticEvent(
                    1,
                    EvidenceArea.FRONTIER,
                    "advanced",
                    mapOf("sequence" to "3"),
                    "stable-device",
                    "stable-operation",
                ),
            ),
            output,
        )
        val text = output.toString(Charsets.UTF_8.name())
        assertTrue(text.contains("device-1") && text.contains("operation-1"))
        assertFalse(text.contains("stable-device") || text.contains("stable-operation"))
    }
    @Test
    public fun rejectsPlaintextAndSupportsCancellation() {
        assertTrue(
            runCatching {
                DiagnosticRedaction.requireSafe(
                    DiagnosticEvent(
                        1,
                        EvidenceArea.MIGRATION,
                        "event",
                        mapOf("outcome" to "profile content"),
                    ),
                )
            }.isFailure,
        )
        val result = DiagnosticExporter.export(
            generateSequence { DiagnosticEvent(1, EvidenceArea.PERFORMANCE, "sample", mapOf("durationMs" to "1")) },
            ByteArrayOutputStream(),
        ) { true }
        assertTrue(result.cancelled)
    }
    @Test
    public fun recorderIsBounded() {
        val recorder = DiagnosticRecorder(2)
        repeat(3) { recorder.record(DiagnosticEvent(it.toLong(), EvidenceArea.ROUTE, "changed", mapOf("routeKind" to "direct"))) }
        assertTrue(recorder.snapshot().size == 2)
    }

    @Test
    public fun truncatesBeforeTheTenMebibyteBoundary() {
        val event = DiagnosticEvent(1, EvidenceArea.PERFORMANCE, "sample", mapOf("outcome" to "x".repeat(120)))
        val output = ByteArrayOutputStream()
        val result = DiagnosticExporter.export(generateSequence { event }, output)
        assertTrue(result.truncated)
        assertTrue(result.bytesWritten <= DiagnosticExporter.MAX_BYTES)
        assertTrue(output.size().toLong() <= DiagnosticExporter.MAX_BYTES)
    }
}
