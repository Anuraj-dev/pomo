package com.pomo.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Color tokens derived from DESIGN.md OKLCH values, pre-converted to sRGB.
 * Neutrals are tinted toward the coral hue so cold blue is never the residual feel.
 */

// Dark theme (default)
public val DarkBg: Color = Color(0xFF0B0B0C)
public val DarkSurface: Color = Color(0xFF1A1A1C)
public val DarkSurfaceElevated: Color = Color(0xFF24232A)
public val DarkOutline: Color = Color(0xFF353339)
public val DarkOutlineStrong: Color = Color(0xFF55525A)
public val DarkOnSurface: Color = Color(0xFFF1EEEF)
public val DarkOnSurfaceMuted: Color = Color(0xFFA8A4A8)
public val DarkOnSurfaceFaint: Color = Color(0xFF6E6A6E)

// Light theme
public val LightBg: Color = Color(0xFFFBF8F2)
public val LightSurface: Color = Color(0xFFFFFFFE)
public val LightSurfaceElevated: Color = Color(0xFFF5F1E8)
public val LightOutline: Color = Color(0xFFDEDAD0)
public val LightOutlineStrong: Color = Color(0xFFB8B4AA)
public val LightOnSurface: Color = Color(0xFF1B1718)
public val LightOnSurfaceMuted: Color = Color(0xFF5D585A)
public val LightOnSurfaceFaint: Color = Color(0xFF8A8588)

// Semantic phase colors. Coral = focus, Teal = break. Dark and light have separate
// values so contrast holds on both surfaces.
public val FocusDark: Color = Color(0xFFFF7A6B)
public val FocusLight: Color = Color(0xFFD64A3F)
public val BreakDark: Color = Color(0xFF5EE0CC)
public val BreakLight: Color = Color(0xFF1E9A8A)

// Accent (goal, streak)
public val AccentDark: Color = Color(0xFFFFD66E)
public val AccentLight: Color = Color(0xFFC79320)

// State
public val SuccessDark: Color = Color(0xFF6BD98C)
public val SuccessLight: Color = Color(0xFF2C8F4E)
public val WarnDark: Color = Color(0xFFFFB45A)
public val WarnLight: Color = Color(0xFFB8721F)
public val DangerDark: Color = Color(0xFFFF6F6F)
public val DangerLight: Color = Color(0xFFC32B2B)

// Legacy aliases kept for screens not yet migrated. Removed after Phase 5.
public val FocusCoral: Color = FocusDark
public val OnFocus: Color = Color(0xFFFFFFFF)
public val FocusContainer: Color = Color(0x33FF7A6B)
public val OnFocusContainer: Color = Color(0xFFFFD8D8)
public val BreakTeal: Color = BreakDark
public val OnBreak: Color = Color(0xFF002A26)
public val BreakContainer: Color = Color(0xFF1F4E4B)
public val OnBreakContainer: Color = Color(0xFFA0EFE7)
public val TertiaryContainer: Color = Color(0xFF4A4458)
public val OnTertiaryContainer: Color = Color(0xFFE8DEF8)
public val OledBackground: Color = DarkBg
public val SurfaceDark: Color = DarkSurface
public val OnSurfaceDark: Color = DarkOnSurface
public val SurfaceVariantDark: Color = DarkOutline
public val OnSurfaceVariantDark: Color = DarkOnSurfaceMuted
public val Gold: Color = AccentDark
public val StatusConnected: Color = SuccessDark
public val StatusOffline: Color = WarnDark
