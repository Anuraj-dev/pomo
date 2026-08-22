package com.pomo.sync.protocol

import com.pomo.sync.crypto.CoseKernelSigner
import com.pomo.sync.crypto.CoseKernelVerifier
import com.pomo.sync.crypto.CoseOperationWire
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec

public class OperationKernelTest {
    private val pair: KeyPair =
        KeyPairGenerator.getInstance("EC").run {
            initialize(ECGenParameterSpec("secp256r1"))
            generateKeyPair()
        }

    @Test
    public fun preferenceTracerBulletAuthorsStoresIngestsAndMaterializesRawWire() {
        val stored = mutableListOf<OperationCommit>()
        val kernel = kernel(OperationStore { commits -> stored += commits })
        val authored = kernel.author(authorRequest("bell")) as AuthorResult.Authored

        assertEquals(IngestDisposition.ACCEPTED, authored.disposition)
        assertEquals(1, stored.size)
        assertEquals(IngestDisposition.DUPLICATE, kernel.ingest(authored.value.signedEnvelope))
        assertEquals(listOf(IngestDisposition.ACCEPTED, IngestDisposition.DUPLICATE), stored.map { it.disposition })
        assertEquals("bell", kernel.materializedPreference("timer.sound"))
        assertEquals(1, kernel.summarize().accepted)
    }

    @Test
    public fun allowlistFamiliesAuthorWithoutBecomingPreferenceProjection() {
        val kernel = kernel()
        assertEquals(IngestDisposition.ACCEPTED, (kernel.author(authorRequest("bell")) as AuthorResult.Authored).disposition)
        val families =
            listOf(
                PomoSuite.HISTORY_KIND to DomainPayload.encodeHistory("CREATE", "block-1", listOf("phase-1")),
                PomoSuite.TAG_KIND to DomainPayload.encodeTag("tag-work", "Work", 0, false, null),
                PomoSuite.PROFILE_KIND to DomainPayload.encodeProfile("Snehit", null),
                PomoSuite.CREW_KIND to DomainPayload.encodeCrew("crew-1", true),
                PomoSuite.TIMER_KIND to DomainPayload.encodeTimer("START", "phase-1", emptyList(), "android", "claim-a"),
            )
        families.forEach { (kind, payload) ->
            val result = kernel.author(authorRequest("bell").copy(preference = null, kind = kind, payload = payload))
            assertTrue(result is AuthorResult.Authored)
            assertEquals(IngestDisposition.ACCEPTED, (result as AuthorResult.Authored).disposition)
            assertEquals(kind, result.value.operation.kind)
        }
        val unknown = OperationCodec.encodePreference(PreferenceSet("timer.sound", PreferenceValue.Text("ignored")))
        val opaque = kernel.author(authorRequest("bell").copy(preference = null, kind = 99, payload = unknown))
        assertTrue(opaque is AuthorResult.Authored)
        assertEquals("bell", kernel.materializedPreference("timer.sound"))
        assertEquals(7, kernel.summarize().accepted)
    }

    @Test
    public fun authoredOperationIsDetachedFromRetainedKernelState() {
        val kernel = kernel()
        val authored = kernel.author(authorRequest("bell")) as AuthorResult.Authored
        authored.value.canonicalPayload[authored.value.canonicalPayload.lastIndex] = 'x'.code.toByte()
        val secondPayload = OperationCodec.encodePreference(PreferenceSet("timer.color", PreferenceValue.Text("blue")))
        val second = authenticated(operation(1, null, secondPayload, deviceId = id(3)), secondPayload)

        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(second.signedEnvelope))
        assertEquals("bell", kernel.materializedPreference("timer.sound"))
        assertEquals("blue", kernel.materializedPreference("timer.color"))
    }

    @Test
    public fun durableStoreFailureCannotMutateKernelState() {
        val kernel = kernel(OperationStore { throw IllegalStateException("disk unavailable") })
        val wire = authenticated(operation(1, null, payload("bell")), payload("bell")).signedEnvelope

        assertEquals(IngestDisposition.REJECTED_INVALID, kernel.ingest(wire))
        assertTrue(kernel.summarize().heads.isEmpty())
    }

    @Test
    public fun rejectedFeedContinuityDoesNotEnterDurableStore() {
        val stored = mutableListOf<OperationCommit>()
        val kernel = kernel(OperationStore { commits -> stored += commits })
        val firstPayload = payload("bell")
        val first = authenticated(operation(1, null, firstPayload), firstPayload)
        val invalidPayload = payload("chime")
        val invalid = authenticated(operation(2, id(9), invalidPayload), invalidPayload)

        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(first.signedEnvelope))
        assertEquals(IngestDisposition.REJECTED_INVALID, kernel.ingest(invalid.signedEnvelope))
        assertEquals(listOf(IngestDisposition.ACCEPTED, IngestDisposition.REJECTED_INVALID), stored.map { it.disposition })
        assertEquals(
            listOf(first.operationId),
            stored.filter { it.disposition == IngestDisposition.ACCEPTED }.map { it.operation.operationId },
        )
    }

    @Test
    public fun quarantinedForkRewindsAndRematerializes() {
        val bell = payload("bell")
        val kernel = kernel()
        val first = authenticated(operation(1, null, bell), bell)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(first.signedEnvelope))
        val secondA = authenticated(operation(2, first.operationId, bell), bell)
        val chime = payload("chime")
        val secondB = authenticated(operation(2, first.operationId, chime), chime)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(secondA.signedEnvelope))
        assertEquals(IngestDisposition.QUARANTINED_FORK, kernel.ingest(secondB.signedEnvelope))
        assertTrue(kernel.summarize().forks.isNotEmpty())
        assertEquals(1, kernel.summarize().accepted)
        assertEquals("bell", kernel.materializedPreference("timer.sound"))
    }

    @Test
    public fun causalSuccessorMaterializesAfterPredecessorEvenWhenItsIdSortsFirst() {
        val predecessorPayload = payload("predecessor")
        val predecessor = authenticated(operation(1, null, predecessorPayload), predecessorPayload)
        val successor =
            (0..1_024).firstNotNullOfOrNull { candidate ->
                val value = "successor-$candidate"
                val candidatePayload = payload(value)
                val authenticated =
                    authenticated(operation(2, predecessor.operationId, candidatePayload), candidatePayload)
                (authenticated to value).takeIf {
                    authenticated.operationId.toString() < predecessor.operationId.toString()
                }
            }
        requireNotNull(successor)
        val kernel = kernel()

        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(predecessor.signedEnvelope))
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(successor.first.signedEnvelope))
        assertEquals(successor.second, kernel.materializedPreference("timer.sound"))
    }

    @Test
    public fun newlyUnlockedLowestIdIsEmittedBeforePreviouslyReadyOperation() {
        val firstPayload = payload("first")
        val first = authenticated(operation(1, null, firstPayload), firstPayload)
        val successor =
            (0..1_024).firstNotNullOfOrNull { candidate ->
                val candidatePayload = payload("successor-$candidate")
                authenticated(operation(2, first.operationId, candidatePayload), candidatePayload)
                    .takeIf { it.operationId.toString() < first.operationId.toString() }
            }
        requireNotNull(successor)
        val concurrent =
            (0..1_024).firstNotNullOfOrNull { candidate ->
                val value = "concurrent-$candidate"
                val candidatePayload = payload(value)
                val authenticated =
                    authenticated(
                        operation(1, null, candidatePayload, deviceId = id(3)),
                        candidatePayload,
                    )
                (authenticated to value).takeIf {
                    authenticated.operationId.toString() > first.operationId.toString()
                }
            }
        requireNotNull(concurrent)
        val kernel = kernel()

        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(first.signedEnvelope))
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(successor.signedEnvelope))
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(concurrent.first.signedEnvelope))
        assertEquals(concurrent.second, kernel.materializedPreference("timer.sound"))
    }

    @Test
    public fun forkQuarantinesAcceptedCrossFeedDependentClosure() {
        val dependencyPayload = payload("dependency")
        val dependency = authenticated(operation(1, null, dependencyPayload), dependencyPayload)
        val dependentPayload = payload("dependent")
        val dependent =
            authenticated(
                operation(
                    sequence = 1,
                    previous = null,
                    payload = dependentPayload,
                    deviceId = id(3),
                    frontier = listOf(FeedFrontier(id(2), incarnation(), 1, dependency.operationId)),
                ),
                dependentPayload,
            )
        val alternatePayload = payload("alternate")
        val alternate = authenticated(operation(1, null, alternatePayload), alternatePayload)
        val kernel = kernel()

        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(dependency.signedEnvelope))
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(dependent.signedEnvelope))
        assertEquals("dependent", kernel.materializedPreference("timer.sound"))
        assertEquals(IngestDisposition.QUARANTINED_FORK, kernel.ingest(alternate.signedEnvelope))
        assertEquals(0, kernel.summarize().accepted)
        assertEquals(3, kernel.summarize().quarantined)
        assertEquals(null, kernel.materializedPreference("timer.sound"))
        assertEquals(IngestDisposition.DUPLICATE, kernel.ingest(dependent.signedEnvelope))
        val authorResult = kernel.author(authorRequest("replacement").copy(deviceId = id(3)))
        assertTrue(authorResult is AuthorResult.Blocked)
        assertTrue((authorResult as AuthorResult.Blocked).missing.contains("UNFORKED_FEED"))
    }

    @Test
    public fun forkQuarantinesPendingDependentWithAnotherMissingDependency() {
        val dependencyPayload = payload("dependency")
        val dependency = authenticated(operation(1, null, dependencyPayload), dependencyPayload)
        val pendingPayload = payload("pending")
        val pending =
            authenticated(
                operation(
                    sequence = 1,
                    previous = null,
                    payload = pendingPayload,
                    deviceId = id(4),
                    frontier =
                        listOf(
                            FeedFrontier(id(2), incarnation(), 1, dependency.operationId),
                            FeedFrontier(id(5), incarnation(), 1, id(8)),
                        ),
                ),
                pendingPayload,
            )
        val alternatePayload = payload("alternate")
        val alternate = authenticated(operation(1, null, alternatePayload), alternatePayload)
        val kernel = kernel()

        assertEquals(IngestDisposition.PENDING_CAUSAL, kernel.ingest(pending.signedEnvelope))
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(dependency.signedEnvelope))
        assertEquals(1, kernel.summarize().pending)
        assertEquals(IngestDisposition.QUARANTINED_FORK, kernel.ingest(alternate.signedEnvelope))
        assertEquals(0, kernel.summarize().pending)
        assertEquals(3, kernel.summarize().quarantined)
    }

    @Test
    public fun blocksAuthoringBeforeDurablePrerequisites() {
        val result =
            kernel().author(
                authorRequest("bell").copy(
                    authorized = false,
                    deviceReady = false,
                    completePrerequisites = emptySet(),
                ),
            )
        assertTrue(result is AuthorResult.Blocked)
        assertEquals(
            setOf("AUTHORIZATION", "DEVICE_READY", "PROFILE_FRONTIER"),
            (result as AuthorResult.Blocked).missing,
        )
    }

    @Test
    public fun causalWaitDrainsAfterExactDependencyArrives() {
        val dependencyPayload = payload("dependency")
        val dependency = authenticated(operation(1, null, dependencyPayload), dependencyPayload)
        val dependentPayload = payload("dependent")
        val dependent =
            authenticated(
                operation(
                    sequence = 1,
                    previous = null,
                    payload = dependentPayload,
                    deviceId = id(3),
                    frontier = listOf(FeedFrontier(id(2), incarnation(), 1, dependency.operationId)),
                ),
                dependentPayload,
            )
        val kernel = kernel()

        assertEquals(IngestDisposition.PENDING_CAUSAL, kernel.ingest(dependent.signedEnvelope))
        assertTrue(kernel.summarize().causalWaits.single().endsWith("@1"))
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(dependency.signedEnvelope))
        assertEquals(2, kernel.summarize().accepted)
        assertEquals(0, kernel.summarize().pending)
        assertEquals("dependent", kernel.materializedPreference("timer.sound"))
    }

    @Test
    public fun pendingLocalFeedBlocksAuthoringUntilItIsContiguous() {
        val pendingPayload = payload("pending")
        val pending = authenticated(operation(2, id(9), pendingPayload), pendingPayload)
        val kernel = kernel()

        assertEquals(IngestDisposition.PENDING_GAP, kernel.ingest(pending.signedEnvelope))
        val result = kernel.author(authorRequest("bell"))
        assertTrue(result is AuthorResult.Blocked)
        assertEquals(setOf("COMPLETE_LOCAL_FEED"), (result as AuthorResult.Blocked).missing)
    }

    @Test
    public fun invalidPredecessorCannotPoisonCandidateOrKnownIdState() {
        val bell = payload("bell")
        val kernel = kernel()
        val first = authenticated(operation(1, null, bell), bell)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(first.signedEnvelope))
        val invalid = authenticated(operation(2, id(9), bell), bell)
        assertEquals(IngestDisposition.REJECTED_INVALID, kernel.ingest(invalid.signedEnvelope))
        val valid = authenticated(operation(2, first.operationId, bell), bell)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(valid.signedEnvelope))
        assertEquals(2, kernel.summarize().accepted)
    }

    @Test
    public fun delayedInvalidPredecessorIsRemovedWhenGapCloses() {
        val bell = payload("bell")
        val kernel = kernel()
        val first = authenticated(operation(1, null, bell), bell)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(first.signedEnvelope))
        val future = authenticated(operation(3, id(9), bell), bell)
        assertEquals(IngestDisposition.PENDING_GAP, kernel.ingest(future.signedEnvelope))
        assertTrue(kernel.summarize().gaps.single().endsWith("@2"))
        val second = authenticated(operation(2, first.operationId, bell), bell)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(second.signedEnvelope))
        assertEquals(2, kernel.summarize().accepted)
        assertEquals(0, kernel.summarize().pending)
        assertEquals(IngestDisposition.REJECTED_INVALID, kernel.ingest(future.signedEnvelope))
    }

    @Test
    public fun malformedAuthenticatedWireIsRejectedBeforeFeedStateChanges() {
        val kernel = kernel()
        assertEquals(IngestDisposition.REJECTED_INVALID, kernel.ingest(byteArrayOf(0x80.toByte())))
        assertTrue(kernel.summarize().heads.isEmpty())
    }

    @Test
    public fun rejectedRestoreLeavesActiveStateUntouched() {
        val bell = payload("bell")
        val kernel = kernel()
        val first = authenticated(operation(1, null, bell), bell)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(first.signedEnvelope))
        val invalidTrailing = authenticated(operation(2, id(9), bell), bell)
        val checkpoint = KernelCheckpoint(PomoSuite.ID, PomoSuite.INITIAL_GENERATION, emptyList(), emptyList())

        assertEquals(RestoreResult.REJECTED_CHECKPOINT, kernel.restore(checkpoint, listOf(invalidTrailing.signedEnvelope)))
        assertEquals("bell", kernel.materializedPreference("timer.sound"))
        assertEquals(1, kernel.summarize().accepted)
    }

    @Test
    public fun noTrailingRestorePreservesCheckpointMaterializedPreferences() {
        val coveredId = id(7)
        val checkpoint =
            KernelCheckpoint(
                PomoSuite.ID,
                PomoSuite.INITIAL_GENERATION,
                listOf(CheckpointFeed(id(2), incarnation(), listOf(coveredId))),
                listOf(CheckpointPreference("timer.sound", "bell")),
            )
        val kernel = kernel(OperationStore { throw IllegalStateException("must not write an empty batch") })

        assertEquals(RestoreResult.RESTORED, kernel.restore(checkpoint, emptyList()))
        assertEquals("bell", kernel.materializedPreference("timer.sound"))
        assertEquals(1, kernel.summarize().accepted)
    }

    @Test
    public fun restorePersistsAllAcceptedTrailingOperationsInOneAtomicBatch() {
        val batches = mutableListOf<List<AuthenticatedOperation>>()
        val firstPayload = payload("bell")
        val first = authenticated(operation(1, null, firstPayload), firstPayload)
        val secondPayload = payload("chime")
        val second = authenticated(operation(2, first.operationId, secondPayload), secondPayload)
        val checkpoint = KernelCheckpoint(PomoSuite.ID, PomoSuite.INITIAL_GENERATION, emptyList(), emptyList())
        val kernel = kernel(OperationStore { commits -> batches.add(commits.map { it.operation }) })

        assertEquals(
            RestoreResult.RESTORED,
            kernel.restore(checkpoint, listOf(first.signedEnvelope, second.signedEnvelope)),
        )
        assertEquals(1, batches.size)
        assertEquals(listOf(first.operationId, second.operationId), batches.single().map { it.operationId })
        assertEquals("chime", kernel.materializedPreference("timer.sound"))
    }

    @Test
    public fun restoreSkipsTrailingOperationsAlreadyDurableInActiveReplica() {
        val persisted = mutableListOf<AuthenticatedOperation>()
        val firstPayload = payload("bell")
        val first = authenticated(operation(1, null, firstPayload), firstPayload)
        val checkpoint = KernelCheckpoint(PomoSuite.ID, PomoSuite.INITIAL_GENERATION, emptyList(), emptyList())
        val kernel = kernel(OperationStore { commits -> persisted += commits.map { it.operation } })

        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(first.signedEnvelope))
        assertEquals(listOf(first.operationId), persisted.map { it.operationId })
        assertEquals(RestoreResult.RESTORED, kernel.restore(checkpoint, listOf(first.signedEnvelope)))
        assertEquals(listOf(first.operationId), persisted.map { it.operationId })
    }

    @Test
    public fun restoreValidatesEveryTrailingOperationBeforeWritingBatch() {
        var batchWrites = 0
        val firstPayload = payload("bell")
        val first = authenticated(operation(1, null, firstPayload), firstPayload)
        val invalidPayload = payload("chime")
        val invalid = authenticated(operation(2, id(9), invalidPayload), invalidPayload)
        val checkpoint = KernelCheckpoint(PomoSuite.ID, PomoSuite.INITIAL_GENERATION, emptyList(), emptyList())
        val kernel = kernel(OperationStore { batchWrites += 1 })

        assertEquals(
            RestoreResult.REJECTED_CHECKPOINT,
            kernel.restore(checkpoint, listOf(first.signedEnvelope, invalid.signedEnvelope)),
        )
        assertEquals(0, batchWrites)
        assertTrue(kernel.summarize().heads.isEmpty())
    }

    @Test
    public fun restoreBatchFailureLeavesDurableAndKernelStateUntouched() {
        val persisted = mutableListOf<AuthenticatedOperation>()
        var rejectBatch = false
        val store =
            OperationStore { commits ->
                if (rejectBatch) throw IllegalStateException("atomic write failed")
                persisted += commits.map { it.operation }
            }
        val kernel = kernel(store)
        val activePayload = payload("bell")
        val active = authenticated(operation(1, null, activePayload), activePayload)
        assertEquals(IngestDisposition.ACCEPTED, kernel.ingest(active.signedEnvelope))
        val durableBeforeRestore = persisted.map { it.operationId }
        rejectBatch = true
        val replacementPayload = payload("chime")
        val replacement = authenticated(operation(1, null, replacementPayload), replacementPayload)
        val checkpoint = KernelCheckpoint(PomoSuite.ID, PomoSuite.INITIAL_GENERATION, emptyList(), emptyList())

        assertEquals(
            RestoreResult.REJECTED_CHECKPOINT,
            kernel.restore(checkpoint, listOf(replacement.signedEnvelope)),
        )
        assertEquals(durableBeforeRestore, persisted.map { it.operationId })
        assertEquals("bell", kernel.materializedPreference("timer.sound"))
        assertEquals(1, kernel.summarize().accepted)
    }

    @Test
    public fun trailingAcceptedOperationAppliesOverCheckpointProjection() {
        val coveredId = id(7)
        val checkpoint =
            KernelCheckpoint(
                PomoSuite.ID,
                PomoSuite.INITIAL_GENERATION,
                listOf(CheckpointFeed(id(2), incarnation(), listOf(coveredId))),
                listOf(CheckpointPreference("timer.sound", "bell")),
            )
        val chime = payload("chime")
        val trailing = authenticated(operation(2, coveredId, chime), chime)
        val kernel = kernel()

        assertEquals(RestoreResult.RESTORED, kernel.restore(checkpoint, listOf(trailing.signedEnvelope)))
        assertEquals("chime", kernel.materializedPreference("timer.sound"))
        assertEquals(2, kernel.summarize().accepted)
    }

    @Test
    public fun restoreRejectsConcurrentTrailingOperationWithoutCheckpointFrontier() {
        val coveredId = id(7)
        val checkpoint =
            KernelCheckpoint(
                PomoSuite.ID,
                PomoSuite.INITIAL_GENERATION,
                listOf(CheckpointFeed(id(2), incarnation(), listOf(coveredId))),
                listOf(CheckpointPreference("timer.sound", "bell")),
            )
        val trailingPayload = payload("chime")
        val trailing = authenticated(operation(1, null, trailingPayload, deviceId = id(3)), trailingPayload)
        val persisted = mutableListOf<AuthenticatedOperation>()
        val kernel = kernel(OperationStore { commits -> persisted += commits.map { it.operation } })

        assertEquals(
            RestoreResult.REJECTED_CHECKPOINT,
            kernel.restore(checkpoint, listOf(trailing.signedEnvelope)),
        )
        assertTrue(persisted.isEmpty())
        assertTrue(kernel.summarize().heads.isEmpty())
    }

    @Test
    public fun checkpointForkInvalidationClearsCheckpointProjection() {
        val checkpoint =
            KernelCheckpoint(
                PomoSuite.ID,
                PomoSuite.INITIAL_GENERATION,
                listOf(CheckpointFeed(id(2), incarnation(), listOf(id(7), id(8), id(9)))),
                listOf(CheckpointPreference("timer.sound", "bell")),
            )
        val kernel = kernel()
        assertEquals(RestoreResult.RESTORED, kernel.restore(checkpoint, emptyList()))
        val alternate = authenticated(operation(1, null, payload("chime")), payload("chime"))

        assertEquals(IngestDisposition.QUARANTINED_FORK, kernel.ingest(alternate.signedEnvelope))
        assertEquals(null, kernel.materializedPreference("timer.sound"))
        assertEquals(0, kernel.summarize().accepted)
        assertEquals(4, kernel.summarize().quarantined)
    }

    @Test
    public fun restoreRejectsUnsortedOrDuplicateCheckpointPreferenceKeys() {
        val unsorted =
            KernelCheckpoint(
                PomoSuite.ID,
                PomoSuite.INITIAL_GENERATION,
                emptyList(),
                listOf(
                    CheckpointPreference("timer.sound", "bell"),
                    CheckpointPreference("focusDurationMinutes", "25"),
                ),
            )
        val duplicate =
            unsorted.copy(
                materializedPreferences =
                    listOf(
                        CheckpointPreference("timer.sound", "bell"),
                        CheckpointPreference("timer.sound", "chime"),
                    ),
            )

        assertEquals(RestoreResult.REJECTED_CHECKPOINT, kernel().restore(unsorted, emptyList()))
        assertEquals(RestoreResult.REJECTED_CHECKPOINT, kernel().restore(duplicate, emptyList()))
    }

    private fun kernel(store: OperationStore = OperationStore { }): OperationKernel =
        OperationKernel(
            CoseKernelSigner(pair.private),
            CoseKernelVerifier { pair.public },
            store,
            CheckpointVerifier { },
        )

    private fun authorRequest(value: String): AuthorRequest =
        AuthorRequest(
            memberId = id(1),
            deviceId = id(2),
            incarnationId = incarnation(),
            authorizationEpoch = 1,
            frontier = emptyList(),
            preference = PreferenceSet("timer.sound", PreferenceValue.Text(value)),
            authorized = true,
            deviceReady = true,
            completePrerequisites = setOf("PROFILE_FRONTIER"),
        )

    private fun authenticated(
        operation: UnsignedOperation,
        payload: ByteArray,
    ): AuthenticatedOperation = CoseOperationWire.sign(operation, payload, pair.private)

    private fun payload(value: String): ByteArray =
        OperationCodec.encodePreference(PreferenceSet("timer.sound", PreferenceValue.Text(value)))

    private fun operation(
        sequence: Long,
        previous: ProtocolBytes?,
        payload: ByteArray,
        deviceId: ProtocolBytes = id(2),
        frontier: List<FeedFrontier> = emptyList(),
    ): UnsignedOperation =
        UnsignedOperation(
            memberId = id(1),
            deviceId = deviceId,
            incarnationId = incarnation(),
            sequence = sequence,
            previousOperationId = previous,
            frontier = frontier,
            authorizationEpoch = 1,
            payloadHash = OperationCodec.payloadHash(payload),
        )

    private fun incarnation(): ProtocolBytes = ProtocolBytes.of(ByteArray(16) { 3 }, 16)

    private fun id(value: Byte): ProtocolBytes = ProtocolBytes.of(ByteArray(32) { value }, 32)
}
