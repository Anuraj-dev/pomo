package com.pomo.cues

import androidx.annotation.StringRes

public data class CuePreviewOutcome(
    val played: Boolean,
    @StringRes val messageRes: Int? = null,
)
