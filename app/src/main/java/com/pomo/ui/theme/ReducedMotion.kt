package com.pomo.ui.theme

import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * Returns true if the system animator scale is zero. Honor this anywhere a
 * non-essential animation runs (ambient breathing, decorative bloom, stagger),
 * but not for state-conveying transitions a user needs to perceive.
 */
@Composable
public fun isReducedMotion(): Boolean {
    val ctx = LocalContext.current
    return remember(ctx) {
        val cr = ctx.contentResolver
        val transitions = Settings.Global.getFloat(cr, Settings.Global.TRANSITION_ANIMATION_SCALE, 1f)
        val animator = Settings.Global.getFloat(cr, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        transitions == 0f || animator == 0f
    }
}
