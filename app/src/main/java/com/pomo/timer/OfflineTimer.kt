package com.pomo.timer

import android.os.CountDownTimer
import com.pomo.db.HistoryCacheRepository
import com.pomo.models.Session
import com.pomo.util.UtilPreferenceManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

public class OfflineTimer(
    private val observer: TimerObserver,
    private val prefs: UtilPreferenceManager,
    private val historyRepository: HistoryCacheRepository,
    private val scope: CoroutineScope,
) {
    private var timer: CountDownTimer? = null
    private var completionJob: Job? = null
    public var state: TimerState = TimerState()
        private set

    public fun updateState(newState: TimerState) {
        this.state = newState
        if (TimerState.STATUS_RUNNING == state.status) {
            startLocalTimer()
        } else {
            stopLocalTimer()
        }
    }

    private fun startLocalTimer() {
        stopLocalTimer()

        val remainingMillis = (state.remaining * 1000).toLong()
        if (remainingMillis <= 0) return

        timer = object : CountDownTimer(remainingMillis, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                state.remaining = millisUntilFinished / 1000.0
                observer.onTimerUpdate(state)
            }

            override fun onFinish() {
                handleTimerComplete()
            }
        }.start()
    }

    private fun stopLocalTimer() {
        timer?.cancel()
        timer = null
    }

    public fun completeExpiredTimer(): Job {
        stopLocalTimer()
        return handleTimerComplete()
    }

    private fun handleTimerComplete(): Job {
        completionJob?.takeIf { it.isActive }?.let { return it }

        val completionState = state.copy()
        val now = System.currentTimeMillis() / 1000
        val sessionStart = completionState.start_time
            .takeIf { it > 0 }
            ?.toLong()
            ?: now - completionState.duration.toLong()
        val session = Session(
            type = completionState.phase,
            start = sessionStart,
            duration = completionState.duration.toInt(),
            completed = true,
        )

        val job = scope.launch {
            historyRepository.saveLocalSession(session, prefs.dayStartHour)

            if (!isStillCompleting(completionState)) {
                return@launch
            }

            state.remaining = 0.0
            state.status = TimerState.STATUS_STOPPED

            if (TimerState.PHASE_WORK == completionState.phase) {
                state.completed = historyRepository.getTodayCompletedCount(prefs.dayStartHour)
                state.date = historyRepository.getEffectiveDateString(prefs.dayStartHour)
                val longBreakAfter = prefs.longBreakAfter

                if (state.completed > 0 && state.completed % longBreakAfter == 0) {
                    state.phase = TimerState.PHASE_LONG
                    state.duration = (prefs.longBreakDuration * 60).toDouble()
                } else {
                    state.phase = TimerState.PHASE_SHORT
                    state.duration = (prefs.shortBreakDuration * 60).toDouble()
                }
            } else {
                state.phase = TimerState.PHASE_WORK
                state.duration = (prefs.pomodoroDuration * 60).toDouble()
            }

            recalculateNextPhase()

            state.remaining = state.duration
            observer.onTimerComplete(state)
        }
        completionJob = job
        job.invokeOnCompletion {
            if (completionJob === job) {
                completionJob = null
            }
        }
        return job
    }

    private fun isStillCompleting(completionState: TimerState): Boolean {
        return state.status == TimerState.STATUS_RUNNING &&
            state.phase == completionState.phase &&
            state.start_time == completionState.start_time &&
            state.duration == completionState.duration
    }

    public fun toggle() {
        if (completionJob?.isActive == true) return
        if (TimerState.STATUS_RUNNING == state.status) {
            state.status = TimerState.STATUS_PAUSED
            state.last_action_time = System.currentTimeMillis() / 1000
            stopLocalTimer()
            observer.onTimerUpdate(state)
        } else {
            state.status = TimerState.STATUS_RUNNING
            state.last_action_time = System.currentTimeMillis() / 1000
            if (state.remaining <= 0) {
                state.remaining = getDurationForPhase(state.phase)
                state.duration = state.remaining
            }
            state.start_time = (System.currentTimeMillis() / 1000).toDouble() - (state.duration - state.remaining)
            startLocalTimer()
            observer.onTimerUpdate(state)
        }
    }

    public fun skip() {
        if (completionJob?.isActive == true) return
        state.status = TimerState.STATUS_STOPPED
        state.last_action_time = System.currentTimeMillis() / 1000
        stopLocalTimer()

        if (TimerState.PHASE_WORK == state.phase) {
            state.phase = TimerState.PHASE_SHORT
            state.duration = (prefs.shortBreakDuration * 60).toDouble()
        } else {
            state.phase = TimerState.PHASE_WORK
            state.duration = (prefs.pomodoroDuration * 60).toDouble()
        }

        recalculateNextPhase()

        state.remaining = state.duration
        observer.onTimerUpdate(state)
    }

    public fun reset() {
        if (completionJob?.isActive == true) return
        state.status = TimerState.STATUS_STOPPED
        state.duration = getDurationForPhase(state.phase)
        state.remaining = state.duration
        state.last_action_time = System.currentTimeMillis() / 1000
        stopLocalTimer()

        recalculateNextPhase()

        observer.onTimerUpdate(state)
    }

    public fun extend(minutes: Int) {
        if (completionJob?.isActive == true) return
        val seconds = (minutes.coerceAtLeast(1) * 60).toDouble()
        state.duration += seconds
        state.remaining += seconds
        state.last_action_time = System.currentTimeMillis() / 1000

        if (TimerState.STATUS_RUNNING == state.status) {
            startLocalTimer()
        }

        observer.onTimerUpdate(state)
    }

    private fun recalculateNextPhase() {
        if (TimerState.PHASE_WORK == state.phase) {
            val nextCompleted = state.completed + 1
            val longBreakAfter = prefs.longBreakAfter

            if (nextCompleted > 0 && nextCompleted % longBreakAfter == 0) {
                state.next_phase = TimerState.PHASE_LONG
            } else {
                state.next_phase = TimerState.PHASE_SHORT
            }
        } else {
            state.next_phase = TimerState.PHASE_WORK
        }
    }

    private fun getDurationForPhase(phase: String): Double {
        val minutes = when (phase) {
            TimerState.PHASE_WORK -> prefs.pomodoroDuration
            TimerState.PHASE_SHORT -> prefs.shortBreakDuration
            TimerState.PHASE_LONG -> prefs.longBreakDuration
            else -> 25
        }
        return (minutes * 60).toDouble()
    }
}
