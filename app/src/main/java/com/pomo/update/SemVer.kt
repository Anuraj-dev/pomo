package com.pomo.update

/**
 * A minimal MAJOR.MINOR.PATCH version. Pre-release / build metadata (anything after
 * the first `-` or `+`, e.g. the `-demo` suffix) is ignored for comparison, matching
 * the release-tag convention produced by CI (`vMAJOR.MINOR.PATCH`).
 */
internal data class SemVer(
    val major: Int,
    val minor: Int,
    val patch: Int,
) : Comparable<SemVer> {
    override fun compareTo(other: SemVer): Int = compareValuesBy(this, other, SemVer::major, SemVer::minor, SemVer::patch)

    internal companion object {
        /**
         * Parses "1.24.2", "v1.24.2", "1.24.2-demo" or "1.24" (→ 1.24.0). Returns null
         * for anything that is not a numeric dotted version so callers can fail safe.
         */
        fun parseOrNull(raw: String): SemVer? {
            val core =
                raw.trim()
                    .removePrefix("v")
                    .removePrefix("V")
                    .substringBefore('-')
                    .substringBefore('+')
            if (core.isEmpty()) return null

            val parts = core.split('.')
            if (parts.size > 3) return null

            val nums =
                parts.map { part ->
                    val n = part.toIntOrNull() ?: return null
                    if (n < 0) return null
                    n
                }
            return SemVer(
                major = nums.getOrElse(0) { 0 },
                minor = nums.getOrElse(1) { 0 },
                patch = nums.getOrElse(2) { 0 },
            )
        }
    }
}
