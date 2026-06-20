package com.pomo.crew

import java.text.BreakIterator
import java.text.Normalizer
import java.time.LocalDate
import java.util.Locale

public object CrewValidation {
    public const val MAX_DISPLAY_NAME_GRAPHEMES: Int = 24
    public const val MAX_CREW_NAME_GRAPHEMES: Int = 40
    public const val MAX_DAILY_AGGREGATES: Int = 30
    public const val MAX_RELAYS: Int = 8
    public const val MAX_SNAPSHOT_BYTES: Int = 32 * 1024

    public fun normalizeDisplayName(value: String): String? =
        normalizeName(value, MAX_DISPLAY_NAME_GRAPHEMES)

    public fun normalizeCrewName(value: String): String? =
        normalizeName(value, MAX_CREW_NAME_GRAPHEMES)

    public fun isValidSnapshot(snapshot: CrewSnapshot): Boolean {
        if (snapshot.version != CrewDefaults.PROTOCOL_VERSION) return false
        if (!isLowerHex(snapshot.crewId, expectedLength = 32)) return false
        if (!isLowerHex(snapshot.identityPublicKey, expectedLength = 64)) return false
        if (normalizeDisplayName(snapshot.displayName) != snapshot.displayName) return false
        if (snapshot.allTimeFocusMinutes < 0 || snapshot.currentStreak < 0) return false
        if (snapshot.publishedAtEpochSeconds <= 0L || snapshot.lastFocusedAtEpochSeconds < 0L) return false
        if (snapshot.utcOffsetMinutes !in MIN_UTC_OFFSET_MINUTES..MAX_UTC_OFFSET_MINUTES) return false
        if (!isIsoDate(snapshot.localDate)) return false
        if (snapshot.dailyAggregates.size > MAX_DAILY_AGGREGATES) return false
        if (snapshot.dailyAggregates.map { it.localDate }.distinct().size != snapshot.dailyAggregates.size) return false
        if (snapshot.dailyAggregates.any { aggregate ->
                !isIsoDate(aggregate.localDate) ||
                    aggregate.focusMinutes < 0 ||
                    aggregate.completedWorkBlocks < 0
            }
        ) return false
        return snapshot.dailyAggregates == snapshot.dailyAggregates.sortedByDescending { it.localDate }
    }

    public fun isLowerHex(value: String, expectedLength: Int): Boolean =
        value.length == expectedLength && value.all { it in '0'..'9' || it in 'a'..'f' }

    private fun normalizeName(value: String, maxGraphemes: Int): String? {
        val normalized = Normalizer.normalize(value, Normalizer.Form.NFC)
            .trim()
            .replace(WHITESPACE, " ")
        if (normalized.isBlank()) return null
        if (normalized.any(::isUnsafeNameCharacter)) return null
        if (graphemeCount(normalized) > maxGraphemes) return null
        return normalized
    }

    private fun graphemeCount(value: String): Int {
        val iterator = BreakIterator.getCharacterInstance(Locale.ROOT)
        iterator.setText(value)
        var count = 0
        var boundary = iterator.first()
        while (boundary != BreakIterator.DONE) {
            val next = iterator.next()
            if (next != BreakIterator.DONE) count += 1
            boundary = next
        }
        return count
    }

    private fun isUnsafeNameCharacter(character: Char): Boolean {
        val type = Character.getType(character)
        return character == '\n' ||
            character == '\r' ||
            type == Character.CONTROL.toInt() ||
            type == Character.FORMAT.toInt() ||
            character in BIDI_OVERRIDES
    }

    private fun isIsoDate(value: String): Boolean =
        runCatching { LocalDate.parse(value).toString() == value }.getOrDefault(false)

    private val WHITESPACE: Regex = Regex("\\s+")
    private val BIDI_OVERRIDES: Set<Char> = setOf(
        '\u202A',
        '\u202B',
        '\u202D',
        '\u202E',
        '\u202C',
        '\u2066',
        '\u2067',
        '\u2068',
        '\u2069',
    )
    private const val MIN_UTC_OFFSET_MINUTES: Int = -18 * 60
    private const val MAX_UTC_OFFSET_MINUTES: Int = 18 * 60
}
