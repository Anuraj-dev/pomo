package com.pomo.profile

/**
 * Renders a member's Identity key public key short enough to read aloud.
 *
 * Display names are not unique, so this is what answers "which of these two is which". It
 * identifies; it does not authenticate — a member is still only as real as their signature.
 */
public object KeyFingerprint {
    private const val GROUP: Int = 4
    private const val GROUPS: Int = 2
    private const val SEPARATOR: String = " · "

    /** `4f2a · 9c11`, or empty if there is no usable key yet. */
    public fun format(publicKeyHex: String): String {
        val hex = publicKeyHex.trim().lowercase()
        if (hex.length < GROUP * GROUPS) return ""
        if (!hex.all { it.isDigit() || it in 'a'..'f' }) return ""
        return (0 until GROUPS).joinToString(SEPARATOR) { group ->
            hex.substring(group * GROUP, (group + 1) * GROUP)
        }
    }
}
