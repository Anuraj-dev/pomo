package com.pomo.sync.transport

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.pomo.db.AppDatabase
import com.pomo.sync.persistence.RoomOperationStore
import com.pomo.sync.ui.SyncSafetyGate
import com.pomo.sync.ui.completeOrdinaryDrain

internal class OrdinaryDrainWorker(
    context: Context,
    params: WorkerParameters,
) : Worker(context, params) {
    override fun doWork(): Result {
        if (!OrdinaryDrainScheduler.hostAllowed()) return Result.success()
        val createdLan = ReplicaLanRuntime.ensureStarted(applicationContext)
        val createdMailbox = WebDavMailboxRuntime.ensureStarted(applicationContext)
        try {
            val store = RoomOperationStore(AppDatabase.getInstance(applicationContext))
            val host =
                OrdinaryDrainHost(
                    routes = ReplicaLanRuntime.drainRoutes() + WebDavMailboxRuntime.drainRoutes(),
                    ingest = ReplicaLanRuntime::ingest,
                    markDelivered = store::markDelivered,
                )
            host.drain(OrdinaryDrainHost.envelopesFrom(store.restartSnapshot()))
            SyncSafetyGate.state = completeOrdinaryDrain(SyncSafetyGate.state)
            return Result.success()
        } finally {
            if (createdMailbox) WebDavMailboxRuntime.stop()
            if (createdLan) ReplicaLanRuntime.stop()
        }
    }
}
