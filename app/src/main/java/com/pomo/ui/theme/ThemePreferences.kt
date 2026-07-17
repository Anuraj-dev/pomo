package com.pomo.ui.theme

import android.content.SharedPreferences

public const val THEME_MODE_PREF_KEY: String = "theme_mode"

public fun SharedPreferences.themeMode(): ThemeMode {
    return when (getString(THEME_MODE_PREF_KEY, ThemeMode.System.preferenceValue)) {
        ThemeMode.Light.preferenceValue -> ThemeMode.Light
        ThemeMode.Dark.preferenceValue -> ThemeMode.Dark
        else -> ThemeMode.System
    }
}

public val ThemeMode.preferenceValue: String
    get() =
        when (this) {
            ThemeMode.System -> "system"
            ThemeMode.Light -> "light"
            ThemeMode.Dark -> "dark"
        }

public val ThemeMode.displayName: String
    get() =
        when (this) {
            ThemeMode.System -> "System"
            ThemeMode.Light -> "Light"
            ThemeMode.Dark -> "Dark"
        }
