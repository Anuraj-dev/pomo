package com.pomo.sync.transport

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.pomo.sync.syncActivationMode
import java.util.concurrent.TimeUnit

internal object OrdinaryDrainScheduler {
    const val PERIODIC_WORK: String = "pomo-ordinary-drain"
    const val IMMEDIATE_WORK: String = "pomo-ordinary-drain-now"

    fun enqueuePeriodic(context: Context) {
        if (!hostAllowed()) return
        val request =
            PeriodicWorkRequestBuilder<OrdinaryDrainWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(),
                )
                .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    fun enqueueNow(context: Context) {
        if (!hostAllowed()) return
        val request =
            OneTimeWorkRequestBuilder<OrdinaryDrainWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE_WORK,
            ExistingWorkPolicy.REPLACE,
            request,
        )
    }

    fun hostAllowed(): Boolean {
        val mode = syncActivationMode
        return mode.testArtifact || mode.productionActivated
    }
}
