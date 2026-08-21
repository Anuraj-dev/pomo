package com.pomo.sync.recovery

import com.pomo.sync.protocol.CborValue
import com.pomo.sync.protocol.DeterministicCbor
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertTrue
import org.junit.Test

public class RecoveryArtifactsTest {
    @Test
    public fun artifactsAreEncryptedBoundedAndCorruptionFailsClosed() {
        val file = RecoveryArtifactCodec.sealFile(
            RecoveryFileBody(byteArrayOf(1, 2), 4, listOf("a@3"), listOf("cap"), listOf("mail")),
            "correct horse",
        )
        assertTrue(RecoveryArtifactCodec.open(file, "correct horse").isNotEmpty())
        val corrupt = file.copy(
            ciphertextAndTag = file.ciphertextAndTag.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() },
        )
        assertTrue(runCatching { RecoveryArtifactCodec.open(corrupt, "correct horse") }.isFailure)
        val archiveBytes = DeterministicCbor.encode(
            CborValue.Array(listOf(CborValue.Integer(1), CborValue.Text("manifest"))),
        )
        assertArrayEquals(
            archiveBytes,
            RecoveryArtifactCodec.open(RecoveryArtifactCodec.sealArchive(archiveBytes, "correct horse"), "correct horse"),
        )
    }

    @Test
    public fun archiveAuthorityAndForwardRestoreFailClosed() {
        val manifest = RecoveryArchiveManifest(
            "archive",
            2,
            listOf("checkpoint"),
            listOf("pack"),
            listOf("blob"),
            ByteArray(32),
            null,
        )
        RecoveryArtifactCodec.validateArchiveManifest(manifest, false)
        assertTrue(runCatching { RecoveryArtifactCodec.validateArchiveManifest(manifest, true) }.isFailure)
        val plan = prepareForwardRestore(
            "safety",
            listOf(RestoreSelection(RestoreDomain.HISTORY, "session", byteArrayOf(1))),
        )
        assertTrue(
            runCatching { authorizeForwardRestore(plan, RestorePlanOrigin.AGENT, false, RestoreApproval(true, false)) }.isFailure,
        )
        assertTrue(
            runCatching {
                prepareForwardRestore("safety", listOf(RestoreSelection(RestoreDomain.ACTIVE_PHASE, "phase", byteArrayOf(1))))
            }.isFailure,
        )
    }

    @Test
    public fun historyUsesDomainCausalityNotWallClockRows() {
        val older = HistoricalValue(RestoreDomain.PROFILE, "me", 1, "op-z", null)
        val newer = older.copy(causalVersion = 2, operationId = "op-a")
        assertTrue(compareHistoricalValues(older, newer) < 0)
    }
}
