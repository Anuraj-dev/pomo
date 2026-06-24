package com.pomo.timer

/**
 * Callback surface that OfflineTimer drives. Extracted from PomodoroService so
 * the timer logic can be unit-tested with a fake observer.
 */
public interface TimerObserver {
    public fun onTimerUpdate(state: TimerState)
    public fun onTimerComplete(state: TimerState)

    /** A partial (skipped) Work block was just recorded to history. Minutes count
     *  toward Focus minutes but no block is earned (ADR-0002). */
    public fun onPartialWorkBlockRecorded() {}
}
