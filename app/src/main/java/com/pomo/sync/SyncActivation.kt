package com.pomo.sync

import com.pomo.BuildConfig

internal data class SyncActivationMode(
    val productionActivated: Boolean,
    val testArtifact: Boolean,
)

internal val syncActivationMode: SyncActivationMode
    get() =
        SyncActivationMode(
            productionActivated = BuildConfig.POMO_SYNC_PRODUCTION_ACTIVATION,
            testArtifact = BuildConfig.POMO_SYNC_TEST_ARTIFACT,
        )
