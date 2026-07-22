package com.pomo.timer

/**
 * Callback surface that OfflineTimer drives. Extracted from PomodoroService so
 * the timer logic can be unit-tested with a fake observer.
 */
public interface TimerObserver {
    public fun onTimerUpdate(state: TimerState)

    /**
     * A phase ran down to zero on its own.
     *
     * [state] has ALREADY advanced to the next phase by the time this fires, so
     * `state.phase` is the phase that is starting. [completedPhase] is the phase
     * that just ended — callers that need to describe what finished (completion
     * cues, history attribution, the `phase_complete` broadcast) must use
     * [completedPhase], never `state.phase`.
     */
    public fun onTimerComplete(
        state: TimerState,
        completedPhase: String,
    )

    /** A partial (skipped) Work block was just recorded to history. Minutes count
     *  toward Focus minutes but no block is earned (ADR-0002). */
    public fun onPartialWorkBlockRecorded() {}
}
