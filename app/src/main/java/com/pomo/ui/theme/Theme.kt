package com.pomo.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

public enum class ThemeMode { System, Light, Dark }

public data class PomoColors(
    val bg: Color,
    val surface: Color,
    val surfaceElevated: Color,
    val outline: Color,
    val outlineStrong: Color,
    val onSurface: Color,
    val onSurfaceMuted: Color,
    val onSurfaceFaint: Color,
    val focus: Color,
    val breakColor: Color,
    val accent: Color,
    val success: Color,
    val warn: Color,
    val danger: Color,
    val isDark: Boolean,
)

public val DarkPomoColors: PomoColors = PomoColors(
    bg = DarkBg,
    surface = DarkSurface,
    surfaceElevated = DarkSurfaceElevated,
    outline = DarkOutline,
    outlineStrong = DarkOutlineStrong,
    onSurface = DarkOnSurface,
    onSurfaceMuted = DarkOnSurfaceMuted,
    onSurfaceFaint = DarkOnSurfaceFaint,
    focus = FocusDark,
    breakColor = BreakDark,
    accent = AccentDark,
    success = SuccessDark,
    warn = WarnDark,
    danger = DangerDark,
    isDark = true,
)

public val LightPomoColors: PomoColors = PomoColors(
    bg = LightBg,
    surface = LightSurface,
    surfaceElevated = LightSurfaceElevated,
    outline = LightOutline,
    outlineStrong = LightOutlineStrong,
    onSurface = LightOnSurface,
    onSurfaceMuted = LightOnSurfaceMuted,
    onSurfaceFaint = LightOnSurfaceFaint,
    focus = FocusLight,
    breakColor = BreakLight,
    accent = AccentLight,
    success = SuccessLight,
    warn = WarnLight,
    danger = DangerLight,
    isDark = false,
)

public val LocalPomoColors: androidx.compose.runtime.ProvidableCompositionLocal<PomoColors> =
    staticCompositionLocalOf { DarkPomoColors }

public fun PomoColors.toMaterialScheme(): androidx.compose.material3.ColorScheme = if (isDark) {
    darkColorScheme(
        primary = focus,
        onPrimary = Color.White,
        primaryContainer = focus.copy(alpha = 0.18f),
        onPrimaryContainer = focus,
        secondary = breakColor,
        onSecondary = Color(0xFF002A26),
        secondaryContainer = breakColor.copy(alpha = 0.18f),
        onSecondaryContainer = breakColor,
        tertiary = accent,
        onTertiary = Color.Black,
        tertiaryContainer = accent.copy(alpha = 0.18f),
        onTertiaryContainer = accent,
        background = bg,
        onBackground = onSurface,
        surface = surface,
        onSurface = onSurface,
        surfaceVariant = surfaceElevated,
        onSurfaceVariant = onSurfaceMuted,
        outline = outline,
        outlineVariant = outline,
        error = danger,
        onError = Color.White,
    )
} else {
    lightColorScheme(
        primary = focus,
        onPrimary = Color.White,
        primaryContainer = focus.copy(alpha = 0.14f),
        onPrimaryContainer = focus,
        secondary = breakColor,
        onSecondary = Color.White,
        secondaryContainer = breakColor.copy(alpha = 0.14f),
        onSecondaryContainer = breakColor,
        tertiary = accent,
        onTertiary = Color.White,
        tertiaryContainer = accent.copy(alpha = 0.14f),
        onTertiaryContainer = accent,
        background = bg,
        onBackground = onSurface,
        surface = surface,
        onSurface = onSurface,
        surfaceVariant = surfaceElevated,
        onSurfaceVariant = onSurfaceMuted,
        outline = outline,
        outlineVariant = outline,
        error = danger,
        onError = Color.White,
    )
}

@Composable
public fun PomoTheme(
    mode: ThemeMode = ThemeMode.System,
    systemIsDark: Boolean = androidx.compose.foundation.isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val useDark = when (mode) {
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
        ThemeMode.System -> systemIsDark
    }
    val pomoColors = if (useDark) DarkPomoColors else LightPomoColors
    androidx.compose.runtime.CompositionLocalProvider(LocalPomoColors provides pomoColors) {
        MaterialTheme(
            colorScheme = pomoColors.toMaterialScheme(),
            typography = PomoTypography,
            shapes = PomoShapes,
            content = content,
        )
    }
}

public object PomoTokens {
    public val colors: PomoColors
        @Composable get() = LocalPomoColors.current
}
