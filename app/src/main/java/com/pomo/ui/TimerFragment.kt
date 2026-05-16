package com.pomo.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.google.android.material.transition.MaterialFadeThrough
import com.pomo.MainActivity
import com.pomo.db.HistoryCacheRepository
import com.pomo.timer.TimerState
import com.pomo.ui.screens.TimerScreen
import com.pomo.ui.screens.TimerStats
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.ThemeMode
import com.pomo.util.DateLogic
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

public class TimerFragment : Fragment() {

    private val timerState = MutableStateFlow<TimerState?>(null)
    private val timerStats = MutableStateFlow(TimerStats())

    private val mainActivity: MainActivity?
        get() = activity as? MainActivity

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enterTransition = MaterialFadeThrough()
        exitTransition = MaterialFadeThrough()
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            PomoTheme(mode = mainActivity?.prefs?.themeMode ?: ThemeMode.System) {
                val state by timerState.collectAsState()
                val stats by timerStats.collectAsState()
                val goal = mainActivity?.prefs?.dailyGoal ?: 8
                val effectiveGoal = if ((state?.goal ?: 0) > 0) state!!.goal else goal
                val workMinutes = mainActivity?.prefs?.pomodoroDuration ?: 25
                TimerScreen(
                    state = state,
                    stats = stats,
                    dailyGoal = effectiveGoal,
                    fallbackWorkSeconds = workMinutes * 60,
                    onToggle = { mainActivity?.toggleTimer() },
                    onSkip = { mainActivity?.skipTimer() },
                    onReset = { mainActivity?.resetTimer() },
                )
            }
        }
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        viewLifecycleOwner.lifecycleScope.launch {
            mainActivity?.service?.stateSnapshot()?.let { updateUI(it) }
        }
        observeStats()
    }

    public fun updateUI(state: TimerState) {
        timerState.value = state.copy()
    }

    private fun observeStats() {
        val ctx = context ?: return
        val repo = HistoryCacheRepository(ctx)
        viewLifecycleOwner.lifecycleScope.launch {
            repo.observeDayStats().combine(currentDateFlow()) { entities, today ->
                val map = entities.associate { e ->
                    e.date to DayEntry(
                        completed = e.completed,
                        work_minutes = e.workMinutes,
                        break_minutes = e.breakMinutes,
                    )
                }
                val activeDates = map.entries
                    .filter { it.value.completed > 0 }
                    .map { it.key }
                    .toSet()
                val todayEntry = map[today]
                TimerStats(
                    todayMinutes = todayEntry?.work_minutes ?: 0,
                    todaySessions = todayEntry?.completed ?: 0,
                    streak = DateLogic.currentStreak(activeDates, System.currentTimeMillis()),
                )
            }.collectLatest { stats ->
                timerStats.value = stats
            }
        }
    }

    private fun currentDateFlow() = flow {
        while (true) {
            emit(DateLogic.effectiveDate(System.currentTimeMillis()))
            delay(DATE_REFRESH_INTERVAL_MS)
        }
    }.distinctUntilChanged()

}

private const val DATE_REFRESH_INTERVAL_MS: Long = 60_000L
