package com.pomo.cues

public enum class CompletionCueFamily(
    public val storageKey: String,
    public val nextVariantPrefKey: String,
) {
    FocusComplete(
        storageKey = "focus_complete",
        nextVariantPrefKey = "state_cues_focus_complete_next_variant",
    ),
    ShortBreakComplete(
        storageKey = "short_break_complete",
        nextVariantPrefKey = "state_cues_short_break_complete_next_variant",
    ),
    LongBreakComplete(
        storageKey = "long_break_complete",
        nextVariantPrefKey = "state_cues_long_break_complete_next_variant",
    ),
    ;

    public companion object {
        public fun fromEvent(event: StateCueEvent): CompletionCueFamily? {
            return when (event) {
                StateCueEvent.FocusToBreakCompletion -> FocusComplete
                StateCueEvent.ShortBreakToFocusCompletion -> ShortBreakComplete
                StateCueEvent.LongBreakToFocusCompletion -> LongBreakComplete
                else -> null
            }
        }
    }
}
