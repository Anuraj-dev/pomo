package com.pomo.cues

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import com.pomo.R

public class CueAudioPlayer(context: Context) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val players: Map<Pair<CompletionCueFamily, CueVariant>, MediaPlayer> =
        buildMap {
            CompletionCueFamily.values().forEach { family ->
                CueVariant.values().forEach { variant ->
                    createPlayer(rawResFor(family, variant))?.let { player ->
                        put(family to variant, player)
                    }
                }
            }
        }

    private var currentPlayer: MediaPlayer? = null
    private var ringPlayer: MediaPlayer? = null

    public fun isAvailable(): Boolean {
        return audioManager.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
            audioManager.getStreamVolume(AudioManager.STREAM_NOTIFICATION) > 0
    }

    /** The looping ring rides the alarm stream, so it is gated on the alarm volume and a
     *  normal ringer — silent/vibrate/DND keep it quiet (vibration carries it instead). */
    public fun isRingAvailable(): Boolean {
        return audioManager.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
            audioManager.getStreamVolume(AudioManager.STREAM_ALARM) > 0
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

    /** Start a looping ring on the alarm stream that plays until [stopRing]. When
     *  [useSystemAlarm] is true it loops the OS default alarm tone, otherwise it loops the
     *  rotation's Pomo completion sample. */
    public fun startRing(
        family: CompletionCueFamily,
        variant: CueVariant,
        useSystemAlarm: Boolean,
    ): Boolean {
        if (!isRingAvailable()) return false
        stopRing()
        val player = if (useSystemAlarm) {
            createSystemAlarmPlayer()
        } else {
            createPlayer(rawResFor(family, variant), AudioAttributes.USAGE_ALARM)
        } ?: return false
        ringPlayer = player
        return try {
            player.isLooping = true
            player.seekTo(0)
            player.start()
            true
        } catch (_: Exception) {
            stopRing()
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

    public fun stopRing() {
        val player = ringPlayer ?: return
        runCatching {
            if (player.isPlaying) {
                player.stop()
            }
            player.release()
        }
        ringPlayer = null
    }

    public fun release() {
        stop()
        stopRing()
        players.values.forEach { player ->
            runCatching { player.release() }
        }
    }

    private fun createSystemAlarmPlayer(): MediaPlayer? {
        val uri = RingtoneManager.getActualDefaultRingtoneUri(appContext, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: return null
        return try {
            MediaPlayer().apply {
                setAudioAttributes(alarmAudioAttributes())
                setDataSource(appContext, uri)
                isLooping = true
                prepare()
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun createPlayer(
        rawResId: Int,
        usage: Int = AudioAttributes.USAGE_ASSISTANCE_SONIFICATION,
    ): MediaPlayer? {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(usage)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        return MediaPlayer.create(appContext, rawResId, audioAttributes, 0)?.apply {
            isLooping = false
        }
    }

    private fun alarmAudioAttributes(): AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    private fun rawResFor(family: CompletionCueFamily, variant: CueVariant): Int = when (family) {
        CompletionCueFamily.FocusComplete -> when (variant) {
            CueVariant.Variant1 -> R.raw.cue_focus_complete_v1
            CueVariant.Variant2 -> R.raw.cue_focus_complete_v2
            CueVariant.Variant3 -> R.raw.cue_focus_complete_v3
        }
        CompletionCueFamily.ShortBreakComplete -> when (variant) {
            CueVariant.Variant1 -> R.raw.cue_short_break_complete_v1
            CueVariant.Variant2 -> R.raw.cue_short_break_complete_v2
            CueVariant.Variant3 -> R.raw.cue_short_break_complete_v3
        }
        CompletionCueFamily.LongBreakComplete -> when (variant) {
            CueVariant.Variant1 -> R.raw.cue_long_break_complete_v1
            CueVariant.Variant2 -> R.raw.cue_long_break_complete_v2
            CueVariant.Variant3 -> R.raw.cue_long_break_complete_v3
        }
    }
}
