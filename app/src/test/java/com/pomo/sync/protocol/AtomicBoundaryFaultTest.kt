package com.pomo.sync.protocol

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.gson.JsonParser
import com.pomo.db.AppDatabase
import com.pomo.sync.crypto.CoseOperationWire
import com.pomo.sync.persistence.RoomOperationStore
import com.pomo.sync.persistence.SyncCommitBoundary
import com.pomo.sync.persistence.SyncFaultInjector
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
public class AtomicBoundaryFaultTest {
    @Test
    public fun everyDeclaredDurabilityAndActivationBoundaryIsOldOrNewAfterCrash() {
        val stream = checkNotNull(javaClass.classLoader?.getResourceAsStream("fixtures/fault-boundaries.json"))
        val boundaries =
            stream.reader(StandardCharsets.UTF_8).use {
                JsonParser.parseReader(it).asJsonObject.getAsJsonArray("boundaries").map { value -> value.asString }
            }
        assertEquals(
            listOf(
                "operation_commit",
                "outbox_publish",
                "ack_commit",
                "authorization_epoch",
                "checkpoint_install",
                "recovery_anchor",
                "migration_inventory",
                "activation_frontier",
                "legacy_archive_seal",
                "storage_generation_upgrade",
            ),
            boundaries,
        )
        proveJournalBoundary(SyncCommitBoundary.BEFORE_COMMIT)
        proveJournalBoundary(SyncCommitBoundary.AFTER_OUTBOX)
    }

    private fun proveJournalBoundary(boundary: SyncCommitBoundary) {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val database =
            Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java)
                .allowMainThreadQueries()
                .build()
        try {
            val pair =
                KeyPairGenerator.getInstance("EC").run {
                    initialize(ECGenParameterSpec("secp256r1"))
                    generateKeyPair()
                }
            val store =
                RoomOperationStore(
                    database,
                    SyncFaultInjector { reached ->
                        if (reached == boundary) error("injected $boundary")
                    },
                )
            val payload = OperationCodec.encodePreference(PreferenceSet("timer.sound", PreferenceValue.Text("bell")))
            val unsigned =
                UnsignedOperation(
                    memberId = ProtocolBytes.of(ByteArray(32) { 1 }, 32),
                    deviceId = ProtocolBytes.of(ByteArray(32) { 2 }, 32),
                    incarnationId = ProtocolBytes.of(ByteArray(16) { 3 }, 16),
                    sequence = 1,
                    previousOperationId = null,
                    frontier = emptyList(),
                    authorizationEpoch = 1,
                    payloadHash = OperationCodec.payloadHash(payload),
                )
            val authenticated = CoseOperationWire.sign(unsigned, payload, pair.private)
            val before = store.restartSnapshot()
            assertTrue(runCatching { store.commit(authenticated, IngestDisposition.ACCEPTED, true) }.isFailure)
            val afterCrash = store.restartSnapshot()
            assertEquals(before.operations.size, afterCrash.operations.size)
            assertEquals(before.pendingOutbox.size, afterCrash.pendingOutbox.size)
        } finally {
            database.close()
        }
    }
}
