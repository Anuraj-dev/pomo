package com.pomo.cues

import android.content.Context
import com.pomo.R
import com.pomo.util.UtilPreferenceManager

public class StateCueEngine(
    context: Context,
    private val prefs: UtilPreferenceManager,
) {
    private val audioPlayer = CueAudioPlayer(context)
    private val hapticPlayer = CueHapticPlayer(context)
    private val rotationStore = CueRotationStore(context)

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
        val played = playCompletionChannels(
            family = family,
            variant = variant,
            channel = CuePreviewChannel.Combined,
            stronger = prefs.isStrongerCompletionCues,
            isPreview = false,
        ).played
        if (played) {
            rotationStore.advance(family)
        }
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
        audioPlayer.stop()
        hapticPlayer.stop()
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
            messageRes = when {
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
