package com.pomo.cues

import android.content.Context
import androidx.preference.PreferenceManager

public class CueRotationStore(context: Context) {
    private val prefs = PreferenceManager.getDefaultSharedPreferences(context.applicationContext)

    public fun nextVariant(family: CompletionCueFamily): CueVariant {
        val stored = prefs.getInt(family.nextVariantPrefKey, CueVariant.Variant1.number)
        return CueVariant.fromNumber(stored)
    }

    public fun advance(family: CompletionCueFamily): CueVariant {
        val next = nextVariant(family).next()
        prefs.edit().putInt(family.nextVariantPrefKey, next.number).apply()
        return next
    }
}
