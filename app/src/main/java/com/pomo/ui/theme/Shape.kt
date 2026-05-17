package com.pomo.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

public object PomoRadius {
    public val Sm: androidx.compose.ui.unit.Dp = 8.dp
    public val Md: androidx.compose.ui.unit.Dp = 14.dp
    public val Lg: androidx.compose.ui.unit.Dp = 20.dp
    public val Pill: androidx.compose.ui.unit.Dp = 999.dp
}

public val PomoShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(PomoRadius.Sm),
    small = RoundedCornerShape(PomoRadius.Sm),
    medium = RoundedCornerShape(PomoRadius.Md),
    large = RoundedCornerShape(PomoRadius.Lg),
    extraLarge = RoundedCornerShape(PomoRadius.Lg),
)
