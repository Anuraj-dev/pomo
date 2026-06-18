package com.pomo.cues

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import com.pomo.R

public class CueAudioPlayer(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val players: Map<Pair<CompletionCueFamily, CueVariant>, MediaPlayer> = buildMap {
        put(
            CompletionCueFamily.FocusComplete to CueVariant.Variant1,
            createPlayer(R.raw.cue_focus_complete_v1),
        )
        put(
            CompletionCueFamily.FocusComplete to CueVariant.Variant2,
            createPlayer(R.raw.cue_focus_complete_v2),
        )
        put(
            CompletionCueFamily.FocusComplete to CueVariant.Variant3,
            createPlayer(R.raw.cue_focus_complete_v3),
        )
        put(
            CompletionCueFamily.ShortBreakComplete to CueVariant.Variant1,
            createPlayer(R.raw.cue_short_break_complete_v1),
        )
        put(
            CompletionCueFamily.ShortBreakComplete to CueVariant.Variant2,
            createPlayer(R.raw.cue_short_break_complete_v2),
        )
        put(
            CompletionCueFamily.ShortBreakComplete to CueVariant.Variant3,
            createPlayer(R.raw.cue_short_break_complete_v3),
        )
        put(
            CompletionCueFamily.LongBreakComplete to CueVariant.Variant1,
            createPlayer(R.raw.cue_long_break_complete_v1),
        )
        put(
            CompletionCueFamily.LongBreakComplete to CueVariant.Variant2,
            createPlayer(R.raw.cue_long_break_complete_v2),
        )
        put(
            CompletionCueFamily.LongBreakComplete to CueVariant.Variant3,
            createPlayer(R.raw.cue_long_break_complete_v3),
        )
    }

    private var currentPlayer: MediaPlayer? = null

    public fun isAvailable(): Boolean {
        return audioManager.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
            audioManager.getStreamVolume(AudioManager.STREAM_NOTIFICATION) > 0
    }

    public fun play(family: CompletionCueFamily, variant: CueVariant): Boolean {
        if (!isAvailable()) return false

        stop()
        val player = players[family to variant] ?: return false
        currentPlayer = player
        return try {
            player.seekTo(0)
            player.start()
            true
        } catch (_: Exception) {
            false
        }
    }

    public fun stop() {
        val player = currentPlayer ?: return
        runCatching {
            if (player.isPlaying) {
                player.pause()
            }
            player.seekTo(0)
        }
        currentPlayer = null
    }

    public fun release() {
        stop()
        players.values.forEach { player ->
            runCatching { player.release() }
        }
    }

    private fun createPlayer(rawResId: Int): MediaPlayer {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        return MediaPlayer.create(appContext, rawResId, audioAttributes, 0).apply {
            isLooping = false
        }
    }
}
