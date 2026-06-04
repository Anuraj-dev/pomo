package com.pomo.ui.theme

import androidx.compose.ui.graphics.Color

// Cool slate neutrals (hue 250) + one signal red. No gold, no warm tints.
// See DESIGN.md for OKLCH source values.

// Dark theme (default, canonical)
public val DarkBg: Color = Color(0xFF131418)
public val DarkSurface: Color = Color(0xFF1B1D22)
public val DarkSurfaceElevated: Color = Color(0xFF24272D)
public val DarkOutline: Color = Color(0xFF363A42)
public val DarkOutlineStrong: Color = Color(0xFF585E69)
public val DarkOnSurface: Color = Color(0xFFF2F3F6)
public val DarkOnSurfaceMuted: Color = Color(0xFFA8ACB5)
public val DarkOnSurfaceFaint: Color = Color(0xFF6E727B)

// Light theme
public val LightBg: Color = Color(0xFFF5F6F8)
public val LightSurface: Color = Color(0xFFEAECEF)
public val LightSurfaceElevated: Color = Color(0xFFE0E3E7)
public val LightOutline: Color = Color(0xFFC1C5CC)
public val LightOutlineStrong: Color = Color(0xFF8E929B)
public val LightOnSurface: Color = Color(0xFF232730)
public val LightOnSurfaceMuted: Color = Color(0xFF5A5F6A)
public val LightOnSurfaceFaint: Color = Color(0xFF8E929B)

// Signal red — the single accent. Marks live state, peak values, current marker, danger.
public val SignalDark: Color = Color(0xFFE84A36)
public val SignalLight: Color = Color(0xFFC0331F)

// State (used sparingly; never decorative)
public val SuccessDark: Color = Color(0xFF6BD98C)
public val SuccessLight: Color = Color(0xFF2C8F4E)
public val WarnDark: Color = Color(0xFFE0B85C)
public val WarnLight: Color = Color(0xFFB8861F)

// Phase has no surface color — phase is communicated through text. Both focus and break
// map to signal red for live indicators (running dot, progress fill). The phase
// distinction is in the caps label, not the hue.
public val FocusDark: Color = SignalDark
public val FocusLight: Color = SignalLight
public val BreakDark: Color = SignalDark
public val BreakLight: Color = SignalLight

// Accent slot remains in the token type for source compatibility, mapped to signal.
public val AccentDark: Color = SignalDark
public val AccentLight: Color = SignalLight

public val DangerDark: Color = SignalDark
public val DangerLight: Color = SignalLight

// Legacy aliases — repainted, not removed, so older screens keep compiling during the
// redesign. Migrate references to PomoTokens.colors over time.
public val FocusCoral: Color = SignalDark
public val OnFocus: Color = Color(0xFFFFFFFF)
public val FocusContainer: Color = Color(0x33E84A36)
public val OnFocusContainer: Color = Color(0xFFFCDAD3)
public val BreakTeal: Color = SignalDark
public val OnBreak: Color = Color(0xFFFFFFFF)
public val BreakContainer: Color = Color(0x33E84A36)
public val OnBreakContainer: Color = Color(0xFFFCDAD3)
public val TertiaryContainer: Color = DarkSurfaceElevated
public val OnTertiaryContainer: Color = DarkOnSurface
public val OledBackground: Color = DarkBg
public val SurfaceDark: Color = DarkSurface
public val OnSurfaceDark: Color = DarkOnSurface
public val SurfaceVariantDark: Color = DarkOutline
public val OnSurfaceVariantDark: Color = DarkOnSurfaceMuted
public val Gold: Color = SignalDark
public val StatusConnected: Color = SuccessDark
public val StatusOffline: Color = WarnDark
