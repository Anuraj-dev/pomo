package com.pomo.crew

import android.content.Context
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.toList

public class LocalCrewRelayStore(context: Context) {
    private val appContext = context.applicationContext
    private val identityStore = CrewIdentityStore(appContext)
    private val projectionStore = CrewProjectionStore(appContext)

    public suspend fun publish(
        snapshot: CrewSnapshot,
        payload: String,
        relays: List<String>,
    ): Boolean {
        projectionStore.upsertLatest(snapshot)
        return transport().publish(snapshot.crewId, payload, relays)
    }

    public suspend fun pull(crewId: String, crewKey: String, relays: List<String>): List<CrewSnapshot> {
        refresh(crewId, crewKey, relays).toList()
        return projectionStore.load(crewId).snapshots
    }

    public fun refresh(crewId: String, crewKey: String, relays: List<String>): Flow<CrewRelayResult> =
        transport().pullIncrementally(crewId, relays)
            .onEach { result ->
                result.events.forEach { event -> acceptEvent(event, crewKey) }
                projectionStore.recordRelayResult(crewId, result.relayUrl, result.error)
            }

    public fun observe(crewId: String, crewKey: String, relays: List<String>): Flow<CrewSnapshot> =
        transport().observe(crewId, relays)
            .mapNotNull { event -> acceptEvent(event, crewKey) }

    public fun observeProjection(crewId: String): Flow<CrewProjection> =
        projectionStore.observe(crewId)

    public suspend fun loadProjection(crewId: String): CrewProjection = projectionStore.load(crewId)

    public suspend fun setHidden(crewId: String, identityPublicKey: String, hidden: Boolean) {
        projectionStore.setHidden(crewId, identityPublicKey, hidden)
    }

    public suspend fun deleteProjection(crewId: String) {
        projectionStore.delete(crewId)
    }

    private suspend fun acceptEvent(event: CrewRelayEvent, crewKey: String): CrewSnapshot? {
        val snapshot = CrewSnapshotCodec.decodeEncrypted(event.content, crewKey) ?: return null
        val now = System.currentTimeMillis() / 1000L
        if (snapshot.identityPublicKey != event.authorPublicKey) return null
        if (event.createdAtEpochSeconds > now + MAX_CLOCK_SKEW_SECONDS) return null
        if (snapshot.publishedAtEpochSeconds > now + MAX_CLOCK_SKEW_SECONDS) return null
        if (snapshot.publishedAtEpochSeconds > event.createdAtEpochSeconds + MAX_CLOCK_SKEW_SECONDS) return null
        projectionStore.upsertLatest(snapshot)
        return snapshot
    }

    private fun transport(): CrewRelayTransport =
        CrewRelayTransport(identityStore.identity().privateKey)

    private companion object {
        private const val MAX_CLOCK_SKEW_SECONDS: Long = 5 * 60L
    }
}
