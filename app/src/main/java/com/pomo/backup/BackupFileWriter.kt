package com.pomo.backup

import java.io.OutputStream

/** Writes encoded backup content through a DocumentsProvider output stream. */
internal object BackupFileWriter {
    // "w" is the mode supported by Android's DocumentsProvider output-stream contract.
    internal const val WRITE_MODE: String = "w"

    internal fun write(
        openOutputStream: (String) -> OutputStream?,
        json: String,
    ): Boolean {
        val bytes = json.toByteArray(Charsets.UTF_8)
        return runCatching {
            openOutputStream(WRITE_MODE)?.use { stream ->
                stream.write(bytes)
                stream.flush()
            } ?: return@runCatching false
            true
        }.getOrDefault(false)
    }
}
