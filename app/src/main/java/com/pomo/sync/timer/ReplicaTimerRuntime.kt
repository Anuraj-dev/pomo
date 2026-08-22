package com.pomo.sync.timer

import com.pomo.sync.transport.OrdinaryDrainScheduler

/**
 * Process-wide kernel-backed timer used when the ordinary drain host is
 * allowed. Product OfflineTimer still drives notifications and widgets; this
 * journal is the sync-facing active-phase authority on test artifacts.
 */
internal object ReplicaTimerRuntime {
    private val lock = Any()
    private var timer: ActivePhaseTimer? = null

    fun start(deviceId: String) {
        if (!OrdinaryDrainScheduler.hostAllowed()) return
        synchronized(lock) {
            if (timer != null) return
            timer = ActivePhaseTimer(deviceId)
        }
    }

    fun stop() {
        synchronized(lock) {
            timer = null
        }
    }

    fun get(): ActivePhaseTimer? = synchronized(lock) { timer }

    fun installForTest(next: ActivePhaseTimer?) {
        synchronized(lock) {
            timer = next
        }
    }
}
