package com.pomo.util

import android.content.Context
import android.content.SharedPreferences
import androidx.preference.PreferenceManager
import com.google.gson.Gson
import com.pomo.timer.TimerState
import java.security.SecureRandom

public class UtilPreferenceManager(context: Context) {
    private val prefs: SharedPreferences = PreferenceManager.getDefaultSharedPreferences(context)
    private val pairingPrefs: SharedPreferences =
        context.getSharedPreferences(PAIRING_PREFS_NAME, Context.MODE_PRIVATE)
    private val gson = Gson()

    public fun saveTimerState(state: TimerState) {
        val json = gson.toJson(state)
        prefs.edit().putString("saved_timer_state", json).apply()
    }

    public fun loadTimerState(): TimerState? {
        val json = prefs.getString("saved_timer_state", null) ?: return null
        return try {
            gson.fromJson(json, TimerState::class.java)
        } catch (e: Exception) {
            null
        }
    }

    public val phoneServerPort: Int
        get() {
            val portStr = prefs.getString("phone_server_port", "9876")
            return portStr
                ?.toIntOrNull()
                ?.takeIf { it in 1..65535 }
                ?: 9876
        }

    public val pairingToken: String
        get() {
            val existing = pairingPrefs.getString(PAIRING_TOKEN_KEY, null)
            if (!existing.isNullOrBlank()) return existing

            val legacy = prefs.getString(PAIRING_TOKEN_KEY, null)
            if (!legacy.isNullOrBlank()) {
                pairingPrefs.edit().putString(PAIRING_TOKEN_KEY, legacy).apply()
                prefs.edit().remove(PAIRING_TOKEN_KEY).apply()
                return legacy
            }

            val token = generateToken()
            pairingPrefs.edit().putString(PAIRING_TOKEN_KEY, token).apply()
            return token
        }

    public fun rotatePairingToken(): String {
        val token = generateToken()
        pairingPrefs.edit().putString(PAIRING_TOKEN_KEY, token).apply()
        prefs.edit().remove(PAIRING_TOKEN_KEY).apply()
        return token
    }

    public val isPhoneServerEnabled: Boolean
        get() = prefs.getBoolean("phone_server_enabled", true)

    public val isPhoneServerWifiOnly: Boolean
        get() = prefs.getBoolean("phone_server_wifi_only", true)

    public val isVibrateEnabled: Boolean
        get() = prefs.getBoolean("vibrate_enabled", true)

    public val isSoundEnabled: Boolean
        get() = prefs.getBoolean("sound_enabled", true)

    public var pomodoroDuration: Int
        get() {
            val str = prefs.getString("pomodoro_duration", "25")
            return sanitizeIntPreference("pomodoro_duration", str?.toIntOrNull(), 25)
        }
        set(value) {
            prefs.edit().putString("pomodoro_duration", sanitizeIntPreference("pomodoro_duration", value, 25).toString()).apply()
        }

    public var shortBreakDuration: Int
        get() {
            val str = prefs.getString("short_break_duration", "5")
            return sanitizeIntPreference("short_break_duration", str?.toIntOrNull(), 5)
        }
        set(value) {
            prefs.edit().putString("short_break_duration", sanitizeIntPreference("short_break_duration", value, 5).toString()).apply()
        }

    public var longBreakDuration: Int
        get() {
            val str = prefs.getString("long_break_duration", "15")
            return sanitizeIntPreference("long_break_duration", str?.toIntOrNull(), 15)
        }
        set(value) {
            prefs.edit().putString("long_break_duration", sanitizeIntPreference("long_break_duration", value, 15).toString()).apply()
        }

    public var longBreakAfter: Int
        get() {
            val str = prefs.getString("long_break_after", "4")
            return sanitizeIntPreference("long_break_after", str?.toIntOrNull(), 4)
        }
        set(value) {
            prefs.edit().putString("long_break_after", sanitizeIntPreference("long_break_after", value, 4).toString()).apply()
        }

    public var dailyGoal: Int
        get() {
            val str = prefs.getString("daily_goal", "8")
            return sanitizeIntPreference("daily_goal", str?.toIntOrNull(), 8)
        }
        set(value) {
            prefs.edit().putString("daily_goal", sanitizeIntPreference("daily_goal", value, 8).toString()).apply()
        }

    public var dayStartHour: Int
        get() {
            val str = prefs.getString("day_start_hour", "3")
            return sanitizeIntPreference("day_start_hour", str?.toIntOrNull(), 3)
        }
        set(value) {
            prefs.edit().putString("day_start_hour", sanitizeIntPreference("day_start_hour", value, 3).toString()).apply()
        }

    public companion object {
        private const val PAIRING_PREFS_NAME: String = "pairing_prefs"
        private const val PAIRING_TOKEN_KEY: String = "pairing_token"

        private fun generateToken(): String {
            val bytes = ByteArray(24)
            SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }

        public fun sanitizeIntPreference(key: String, value: Int?, default: Int): Int {
            val parsed = value ?: return default
            return when (key) {
                "pomodoro_duration", "short_break_duration", "long_break_duration", "long_break_after" ->
                    parsed.takeIf { it > 0 } ?: default
                "daily_goal" ->
                    parsed.takeIf { it >= 0 } ?: default
                "day_start_hour" ->
                    parsed.takeIf { it in 0..23 } ?: default
                "phone_server_port" ->
                    parsed.takeIf { it in 1..65535 } ?: default
                else ->
                    parsed
            }
        }
    }
}
