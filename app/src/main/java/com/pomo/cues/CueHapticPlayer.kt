package com.pomo.cues

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlin.math.roundToLong

public class CueHapticPlayer(context: Context) {
    private val vibrator: Vibrator =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }

    public fun isAvailable(): Boolean = vibrator.hasVibrator()

    public fun stop() {
        runCatching { vibrator.cancel() }
    }

    public fun playCompletion(
        family: CompletionCueFamily,
        variant: CueVariant,
        stronger: Boolean,
    ): Boolean {
        if (!isAvailable()) return false
        val basePattern = completionPattern(family, variant)
        val pattern = if (stronger) stretchPattern(basePattern, 1.35) else basePattern
        return vibrateWaveform(pattern)
    }

    /** Loop a buzz pattern until [stop]. Carries the ring in vibrate mode where the
     *  alarm audio is suppressed. */
    public fun startRing(): Boolean {
        if (!isAvailable()) return false
        val pattern = longArrayOf(0, 500, 700)
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(pattern, 0)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    public fun playManual(event: StateCueEvent): Boolean {
        if (!isAvailable()) return false
        return when (event) {
            StateCueEvent.StartOrResumeTapped -> vibrateOneShot(24)
            StateCueEvent.PauseTapped -> vibrateWaveform(longArrayOf(0, 18, 30, 18))
            StateCueEvent.SkipTapped -> vibrateWaveform(longArrayOf(0, 28, 34, 34))
            StateCueEvent.ResetTapped -> vibrateWaveform(longArrayOf(0, 38, 32, 58))
            else -> false
        }
    }

    private fun completionPattern(
        family: CompletionCueFamily,
        variant: CueVariant,
    ): LongArray {
        return when (family) {
            CompletionCueFamily.FocusComplete ->
                when (variant) {
                    CueVariant.Variant1 -> longArrayOf(0, 52, 86, 44, 126, 34)
                    CueVariant.Variant2 -> longArrayOf(0, 56, 78, 48, 118, 30)
                    CueVariant.Variant3 -> longArrayOf(0, 50, 92, 40, 132, 28)
                }
            CompletionCueFamily.ShortBreakComplete ->
                when (variant) {
                    CueVariant.Variant1 -> longArrayOf(0, 34, 58, 40)
                    CueVariant.Variant2 -> longArrayOf(0, 30, 52, 46)
                    CueVariant.Variant3 -> longArrayOf(0, 36, 62, 36)
                }
            CompletionCueFamily.LongBreakComplete ->
                when (variant) {
                    CueVariant.Variant1 -> longArrayOf(0, 42, 78, 48, 72)
                    CueVariant.Variant2 -> longArrayOf(0, 46, 72, 52, 76)
                    CueVariant.Variant3 -> longArrayOf(0, 40, 84, 44, 82)
                }
        }
    }

    private fun stretchPattern(
        pattern: LongArray,
        factor: Double,
    ): LongArray {
        return LongArray(pattern.size) { idx ->
            (pattern[idx] * factor).roundToLong()
        }
    }

    private fun vibrateOneShot(durationMs: Long): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(durationMs)
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun vibrateWaveform(pattern: LongArray): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                vibrator.vibrate(pattern, -1)
            }
            true
        } catch (_: Exception) {
            false
        }
    }
}
