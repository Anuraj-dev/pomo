package com.pomo.sync.diagnostics

import java.io.OutputStream

internal enum class EvidenceArea {
    STATE_TRANSITION,
    FRONTIER,
    DISPOSITION,
    ROUTE,
    COMMIT_ACK,
    LIFECYCLE_GENERATION,
    RETRY_BACKOFF,
    PROVIDER_PROTECTION,
    CHECKPOINT_REHYDRATION,
    MIGRATION,
    COMPATIBILITY,
    SAFE_MODE,
    PERFORMANCE,
}

internal data class DiagnosticEvent(
    val monotonicMillis: Long,
    val area: EvidenceArea,
    val event: String,
    val fields: Map<String, String>,
    val deviceRef: String? = null,
    val operationRef: String? = null,
)

internal class DiagnosticRecorder(private val capacity: Int = 2_048) {
    private val events = ArrayDeque<DiagnosticEvent>()

    @Synchronized
    fun record(event: DiagnosticEvent) {
        DiagnosticRedaction.requireSafe(event)
        while (events.size >= capacity) events.removeFirst()
        events.addLast(event)
    }

    @Synchronized
    fun snapshot(): List<DiagnosticEvent> = events.toList()
}

internal object DiagnosticRedaction {
    private val allowedFields =
        setOf(
            "from",
            "to",
            "count",
            "sequence",
            "generation",
            "durationMs",
            "batchSize",
            "attempt",
            "delayMs",
            "outcome",
            "reasonCode",
            "routeKind",
            "sourceKind",
            "formatVersion",
        )
    private val forbidden = Regex("(?i)(key|secret|token|credential|capability|recovery|profile|photo|tag|history|payload|content|member)")
    fun requireSafe(event: DiagnosticEvent) {
        require(event.event.length in 1..80 && !forbidden.containsMatchIn(event.event))
        require(event.fields.size <= 24)
        event.fields.forEach { (key, value) ->
            require(key in allowedFields && value.length <= 120 && !forbidden.containsMatchIn(value)) { "Diagnostic field is not export-safe" }
        }
    }
}

internal data class DiagnosticExportResult(
    val bytesWritten: Long,
    val eventsWritten: Int,
    val truncated: Boolean,
    val cancelled: Boolean,
)

internal object DiagnosticExporter {
    const val MAX_BYTES: Long = 10L * 1024L * 1024L

    fun export(
        events: Sequence<DiagnosticEvent>,
        output: OutputStream,
        cancelled: () -> Boolean = { false },
    ): DiagnosticExportResult {
        val deviceAliases = linkedMapOf<String, String>()
        val operationAliases = linkedMapOf<String, String>()
        var bytes = 0L
        var count = 0
        for (event in events) {
            if (cancelled()) {
                return DiagnosticExportResult(bytes, count, truncated = false, cancelled = true)
            }
            DiagnosticRedaction.requireSafe(event)
            val line = encode(event, deviceAliases, operationAliases).toByteArray(Charsets.UTF_8)
            if (bytes + line.size > MAX_BYTES) {
                return DiagnosticExportResult(bytes, count, truncated = true, cancelled = false)
            }
            output.write(line)
            bytes += line.size
            count += 1
        }
        return DiagnosticExportResult(bytes, count, truncated = false, cancelled = false)
    }

    private fun encode(
        event: DiagnosticEvent,
        devices: MutableMap<String, String>,
        operations: MutableMap<String, String>,
    ): String {
        val fields =
            event.fields.toSortedMap().entries.joinToString(",") { (key, value) ->
                "\"${escape(key)}\":\"${escape(value)}\""
            }
        val device = event.deviceRef?.let { devices.getOrPut(it) { "device-${devices.size + 1}" } }
        val operation = event.operationRef?.let { operations.getOrPut(it) { "operation-${operations.size + 1}" } }
        return buildString {
            append(
                "{\"v\":1,\"monotonicMillis\":${event.monotonicMillis}," +
                    "\"area\":\"${event.area.name}\",\"event\":\"${escape(event.event)}\"," +
                    "\"fields\":{$fields}",
            )
            if (device != null) append(",\"deviceAlias\":\"$device\"")
            if (operation != null) append(",\"operationAlias\":\"$operation\"")
            append("}\n")
        }
    }

    private fun escape(value: String): String =
        buildString {
            value.forEach { character ->
                when (character) {
                    '\\' -> append("\\\\")
                    '"' -> append("\\\"")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else ->
                        if (character.code < 0x20) {
                            append("\\u%04x".format(character.code))
                        } else {
                            append(character)
                        }
                }
            }
        }
}
