package com.pomo.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing

public object PomoMotion {
    public const val DurationXs: Int = 120
    public const val DurationS: Int = 180
    public const val DurationM: Int = 240
    public const val DurationL: Int = 360
    public const val DurationXl: Int = 480

    public val EaseStandard: Easing = CubicBezierEasing(0.2f, 0.0f, 0.0f, 1.0f)
    public val EaseOutQuint: Easing = CubicBezierEasing(0.22f, 1.0f, 0.36f, 1.0f)
    public val EaseOutExpo: Easing = CubicBezierEasing(0.16f, 1.0f, 0.30f, 1.0f)
}
