package com.pomo.cues

import com.pomo.timer.TimerState

public enum class StateCueEvent {
    FocusToBreakCompletion,
    ShortBreakToFocusCompletion,
    LongBreakToFocusCompletion,
    StartOrResumeTapped,
    PauseTapped,
    SkipTapped,
    ResetTapped,
    ;

    public val isManual: Boolean
        get() =
            when (this) {
                StartOrResumeTapped, PauseTapped, SkipTapped, ResetTapped -> true
                else -> false
            }

    public companion object {
        public fun forCompletedPhase(phase: String): StateCueEvent? {
            return when (phase) {
                TimerState.PHASE_WORK -> FocusToBreakCompletion
                TimerState.PHASE_SHORT -> ShortBreakToFocusCompletion
                TimerState.PHASE_LONG -> LongBreakToFocusCompletion
                else -> null
            }
        }
    }
}
