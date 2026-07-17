package com.pomo.backup

import com.pomo.crew.CrewDefaults
import com.pomo.timer.TimerState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

public class BackupCodecTest {
    private val backup =
        PomoBackup(
            exportedAtEpochSeconds = 1_770_000_000L,
            appVersionName = "1.30.0",
            history =
                BackupHistory(
                    dayStats = listOf(BackupDayStats("2026-07-01", completed = 2, workMinutes = 50, breakMinutes = 5)),
                    sessions =
                        listOf(
                            BackupSession(1_000L, "2026-07-01", TimerState.PHASE_WORK, 1_500, completed = true),
                        ),
                ),
            crew =
                BackupCrew(
                    identityPrivateKey = "ab".repeat(32),
                    activeCrewId = "11".repeat(16),
                    memberships =
                        listOf(
                            BackupMembership(
                                crewId = "11".repeat(16),
                                crewName = "Deep Work",
                                joinCode = "pomo-crew.v1.abc",
                                relays = listOf("wss://relay.example"),
                                key = "22".repeat(32),
                                displayName = "Snehit",
                                protocolVersion = CrewDefaults.PROTOCOL_VERSION,
                            ),
                        ),
                    hiddenMembers = listOf(BackupHiddenMember("11".repeat(16), "33".repeat(32), 1_000L)),
                ),
        )

    @Test
    public fun `survives a round trip`() {
        val decoded = BackupCodec.decode(BackupCodec.encode(backup))
        assertEquals(backup, decoded)
    }

    @Test
    public fun `rejects a file that is not a pomo backup`() {
        assertNull(BackupCodec.decode("""{"hello":"world"}"""))
        assertNull(BackupCodec.decode("not json at all"))
        assertNull(BackupCodec.decode(""))
    }

    @Test
    public fun `rejects a backup written by a newer format`() {
        val future =
            BackupCodec.encode(backup).replace(
                """"version": ${PomoBackup.VERSION}""",
                """"version": ${PomoBackup.VERSION + 1}""",
            )
        assertNull(BackupCodec.decode(future))
    }

    @Test
    public fun `drops rows a hand-edited file got wrong and keeps the rest`() {
        val decoded =
            BackupCodec.decode(
                BackupCodec.encode(
                    backup.copy(
                        history =
                            BackupHistory(
                                dayStats = backup.history.dayStats + BackupDayStats("nonsense", completed = 1),
                                sessions =
                                    backup.history.sessions +
                                        listOf(
                                            BackupSession(2_000L, "2026-07-01", "nap", 600, completed = true),
                                            BackupSession(0L, "2026-07-01", TimerState.PHASE_WORK, 600, completed = true),
                                        ),
                            ),
                    ),
                ),
            )

        assertEquals(1, decoded?.history?.dayStats?.size)
        assertEquals(listOf(1_000L), decoded?.history?.sessions?.map { it.start })
    }

    @Test
    public fun `drops an identity key that is not a valid private key`() {
        val decoded =
            BackupCodec.decode(
                BackupCodec.encode(backup.copy(crew = backup.crew.copy(identityPrivateKey = "zz"))),
            )
        assertEquals("", decoded?.crew?.identityPrivateKey)
    }

    @Test
    public fun `drops a membership from an older protocol version`() {
        val stale = backup.crew.memberships.map { it.copy(protocolVersion = CrewDefaults.PROTOCOL_VERSION - 1) }
        val decoded =
            BackupCodec.decode(
                BackupCodec.encode(backup.copy(crew = backup.crew.copy(memberships = stale))),
            )
        assertTrue(decoded?.crew?.memberships.orEmpty().isEmpty())
    }
}
