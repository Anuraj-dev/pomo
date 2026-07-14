package com.pomo.backup

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.pomo.crew.CrewDefaults
import com.pomo.crew.CrewValidation
import com.pomo.timer.TimerState

/**
 * Reads and writes the plain-JSON backup file. The file is user-owned and hand-editable, so decode
 * treats it as untrusted input: a malformed row is dropped rather than allowed to fail the whole
 * restore, but a file that is not a Pomo backup at all decodes to null.
 */
public object BackupCodec {

    private const val MAX_BYTES: Int = 64 * 1024 * 1024

    private val pretty: Gson = GsonBuilder().setPrettyPrinting().serializeNulls().create()
    private val plain: Gson = Gson()

    public fun encode(backup: PomoBackup): String = pretty.toJson(backup)

    public fun decode(json: String): PomoBackup? {
        if (json.length > MAX_BYTES) return null
        // Every field of PomoBackup carries a default, so Gson happily turns any JSON object into a
        // valid-looking empty backup. The format and version must be read off the file itself.
        val root = runCatching { JsonParser.parseString(json) }.getOrNull()
            ?.takeIf { it.isJsonObject }
            ?.asJsonObject
            ?: return null
        if (root.stringOrNull("format") != PomoBackup.FORMAT) return null
        val version = root.intOrNull("version") ?: return null
        if (version !in 1..PomoBackup.VERSION) return null
        val decoded = runCatching { plain.fromJson(root, PomoBackup::class.java) }.getOrNull()
            ?: return null
        return decoded.sanitized()
    }

    private fun JsonObject.stringOrNull(key: String): String? =
        get(key)?.takeIf { it.isJsonPrimitive }?.asString

    private fun JsonObject.intOrNull(key: String): Int? =
        get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asInt

    private fun PomoBackup.sanitized(): PomoBackup = copy(
        history = BackupHistory(
            dayStats = history.dayStats.filter { it.date.isValidDate() && it.isNonNegative() },
            sessions = history.sessions.filter { it.isValid() },
        ),
        crew = crew.copy(
            identityPrivateKey = crew.identityPrivateKey
                .takeIf { CrewValidation.isLowerHex(it, IDENTITY_KEY_HEX_LENGTH) }
                .orEmpty(),
            memberships = crew.memberships.filter { it.isValid() },
            snapshots = crew.snapshots.filter { it.crewId.isNotBlank() && it.identityPublicKey.isNotBlank() },
            dailyAggregates = crew.dailyAggregates.filter {
                it.crewId.isNotBlank() && it.identityPublicKey.isNotBlank() && it.localDate.isValidDate()
            },
            hiddenMembers = crew.hiddenMembers.filter {
                it.crewId.isNotBlank() && it.identityPublicKey.isNotBlank()
            },
        ),
    )

    private fun BackupDayStats.isNonNegative(): Boolean =
        completed >= 0 && workMinutes >= 0 && breakMinutes >= 0

    private fun BackupSession.isValid(): Boolean =
        start > 0L &&
            date.isValidDate() &&
            duration >= 0 &&
            type in KNOWN_PHASES

    private fun BackupMembership.isValid(): Boolean =
        crewId.isNotBlank() &&
            key.isNotBlank() &&
            joinCode.isNotBlank() &&
            protocolVersion == CrewDefaults.PROTOCOL_VERSION

    /** `yyyy-MM-dd`, checked by shape only — Room stores dates as opaque strings. */
    private fun String.isValidDate(): Boolean =
        length == 10 && this[4] == '-' && this[7] == '-' &&
            indices.all { i -> i == 4 || i == 7 || this[i].isDigit() }

    private const val IDENTITY_KEY_HEX_LENGTH: Int = 64

    private val KNOWN_PHASES: Set<String> = setOf(
        TimerState.PHASE_WORK,
        TimerState.PHASE_SHORT,
        TimerState.PHASE_LONG,
    )
}
