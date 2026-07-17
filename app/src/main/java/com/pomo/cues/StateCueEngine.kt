package com.pomo.cues

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.pomo.R
import com.pomo.util.UtilPreferenceManager

public class StateCueEngine(
    context: Context,
    private val prefs: UtilPreferenceManager,
    private val onRingStateChanged: () -> Unit = {},
) {
    private companion object {
        private const val TAG = "StateCueEngine"
        private const val RING_TIMEOUT_MS = 60_000L
    }

    private val audioPlayer = CueAudioPlayer(context)
    private val hapticPlayer = CueHapticPlayer(context)
    private val rotationStore = CueRotationStore(context)
    private val ringHandler = Handler(Looper.getMainLooper())
    private var ringActive = false

    public fun isRinging(): Boolean = ringActive

    public fun availability(): CueAvailability {
        return CueAvailability(
            soundEnabled = prefs.isSoundEnabled,
            soundAvailable = audioPlayer.isAvailable(),
            vibrationEnabled = prefs.isVibrateEnabled,
            vibrationAvailable = hapticPlayer.isAvailable(),
        )
    }

    public fun nextVariant(family: CompletionCueFamily): CueVariant = rotationStore.nextVariant(family)

    public fun playCompletion(event: StateCueEvent) {
        val family = CompletionCueFamily.fromEvent(event) ?: return
        stop()
        val variant = rotationStore.nextVariant(family)

        val played =
            if (prefs.isRingUntilDismissed) {
                startRing(family, variant)
            } else {
                playCompletionChannels(
                    family = family,
                    variant = variant,
                    channel = CuePreviewChannel.Combined,
                    stronger = prefs.isStrongerCompletionCues,
                    isPreview = false,
                ).played
            }
        if (played) {
            rotationStore.advance(family)
        } else {
            Log.d(TAG, "Completion cue skipped: no enabled or available channel for $family")
        }
    }

    private fun startRing(
        family: CompletionCueFamily,
        variant: CueVariant,
    ): Boolean {
        val availability = availability()
        var playedAny = false
        if (availability.soundEnabled && audioPlayer.isRingAvailable()) {
            val useSystemAlarm = prefs.ringSound == UtilPreferenceManager.RING_SOUND_SYSTEM_ALARM
            playedAny = audioPlayer.startRing(family, variant, useSystemAlarm) || playedAny
        }
        if (availability.vibrationEnabled && availability.vibrationAvailable) {
            playedAny = hapticPlayer.startRing() || playedAny
        }
        if (!playedAny) return false

        ringActive = true
        ringHandler.removeCallbacksAndMessages(null)
        ringHandler.postDelayed({ stop() }, RING_TIMEOUT_MS)
        onRingStateChanged()
        return true
    }

    public fun playManual(event: StateCueEvent) {
        if (!event.isManual) return
        stop()
        if (prefs.isVibrateEnabled && hapticPlayer.isAvailable()) {
            hapticPlayer.playManual(event)
        }
    }

    public fun previewCompletion(
        family: CompletionCueFamily,
        variant: CueVariant,
        channel: CuePreviewChannel,
    ): CuePreviewOutcome {
        stop()
        return playCompletionChannels(
            family = family,
            variant = variant,
            channel = channel,
            stronger = prefs.isStrongerCompletionCues,
            isPreview = true,
        )
    }

    public fun previewManual(event: StateCueEvent): CuePreviewOutcome {
        stop()
        if (!event.isManual) return CuePreviewOutcome(false, R.string.state_cues_preview_unavailable)

        val availability = availability()
        if (!availability.vibrationEnabled) {
            return CuePreviewOutcome(false, R.string.state_cues_preview_vibration_off)
        }
        if (!availability.vibrationAvailable) {
            return CuePreviewOutcome(false, R.string.state_cues_preview_vibration_unavailable)
        }

        val played = hapticPlayer.playManual(event)
        return if (played) CuePreviewOutcome(true) else CuePreviewOutcome(false, R.string.state_cues_preview_unavailable)
    }

    public fun stop() {
        ringHandler.removeCallbacksAndMessages(null)
        audioPlayer.stop()
        audioPlayer.stopRing()
        hapticPlayer.stop()
        if (ringActive) {
            ringActive = false
            onRingStateChanged()
        }
    }

    public fun release() {
        stop()
        audioPlayer.release()
    }

    private fun playCompletionChannels(
        family: CompletionCueFamily,
        variant: CueVariant,
        channel: CuePreviewChannel,
        stronger: Boolean,
        isPreview: Boolean,
    ): CuePreviewOutcome {
        val availability = availability()
        var playedAny = false

        when (channel) {
            CuePreviewChannel.Combined -> {
                if (availability.soundEnabled && availability.soundAvailable) {
                    playedAny = audioPlayer.play(family, variant) || playedAny
                }
                if (availability.vibrationEnabled && availability.vibrationAvailable) {
                    playedAny = hapticPlayer.playCompletion(family, variant, stronger) || playedAny
                }
            }
            CuePreviewChannel.AudioOnly -> {
                if (!availability.soundEnabled) {
                    return CuePreviewOutcome(false, R.string.state_cues_preview_sound_off)
                }
                if (!availability.soundAvailable) {
                    return CuePreviewOutcome(false, R.string.state_cues_preview_sound_unavailable)
                }
                playedAny = audioPlayer.play(family, variant)
            }
            CuePreviewChannel.HapticOnly -> {
                if (!availability.vibrationEnabled) {
                    return CuePreviewOutcome(false, R.string.state_cues_preview_vibration_off)
                }
                if (!availability.vibrationAvailable) {
                    return CuePreviewOutcome(false, R.string.state_cues_preview_vibration_unavailable)
                }
                playedAny = hapticPlayer.playCompletion(family, variant, stronger)
            }
        }

        if (playedAny) return CuePreviewOutcome(true)
        if (!isPreview) return CuePreviewOutcome(false)

        return CuePreviewOutcome(
            played = false,
            messageRes =
                when {
                    !availability.soundEnabled && !availability.vibrationEnabled ->
                        R.string.state_cues_preview_no_channels
                    !availability.soundEnabled && !availability.vibrationAvailable ->
                        R.string.state_cues_preview_no_channels
                    !availability.vibrationEnabled && !availability.soundAvailable ->
                        R.string.state_cues_preview_no_channels
                    !availability.soundAvailable && !availability.vibrationAvailable ->
                        R.string.state_cues_preview_no_channels
                    else -> R.string.state_cues_preview_unavailable
                },
        )
    }
}
