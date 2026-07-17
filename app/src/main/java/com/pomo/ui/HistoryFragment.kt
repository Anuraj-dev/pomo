package com.pomo.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.preference.PreferenceManager
import com.pomo.MainActivity
import com.pomo.db.DayStatsEntity
import com.pomo.db.HistoryCacheRepository
import com.pomo.stats.HourRhythm
import com.pomo.stats.StatsAggregator
import com.pomo.tags.TagStore
import com.pomo.ui.screens.HistoryScreen
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.themeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

public class HistoryFragment : Fragment() {
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        val ctx = requireContext()
        val repo = HistoryCacheRepository(ctx)
        val tagStore = TagStore(ctx)
        val itemsFlow: Flow<List<HistoryItem>> =
            repo.observeDayStats()
                .map { entities -> entities.toHistoryItems() }
        val loadRhythm: suspend (String) -> HourRhythm = { date ->
            StatsAggregator.hourRhythmForDay(repo.getSessionsForDate(date))
        }
        val loadSessions: suspend (String) -> List<com.pomo.db.SessionEntity> = { date ->
            repo.getSessionsForDate(date)
        }
        val isToday: (String) -> Boolean = { date ->
            val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
            date == today
        }
        return ComposeView(requireContext()).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                val availableTags = remember { tagStore.getTags() }
                PomoTheme(mode = PreferenceManager.getDefaultSharedPreferences(requireContext()).themeMode()) {
                    val items by itemsFlow.collectAsState(initial = emptyList())
                    HistoryScreen(
                        items = items,
                        loadRhythm = loadRhythm,
                        loadSessions = loadSessions,
                        onTagSession = { startTime, tag ->
                            val service = (activity as? MainActivity)?.service
                            if (service != null) {
                                viewLifecycleOwner.lifecycleScope.launch {
                                    service.updateSessionTag(startTime, tag)
                                }
                            }
                        },
                        availableTags = availableTags,
                        isToday = isToday,
                    )
                }
            }
        }
    }
}

public data class DayEntry(
    val completed: Int,
    val work_minutes: Int,
    val break_minutes: Int,
)

public data class HistoryItem(val date: String, val entry: DayEntry)

internal fun List<DayStatsEntity>.toHistoryItems(): List<HistoryItem> =
    map { e ->
        HistoryItem(
            date = e.date,
            entry =
                DayEntry(
                    completed = e.completed,
                    work_minutes = e.workMinutes,
                    break_minutes = e.breakMinutes,
                ),
        )
    }.sortedByDescending { it.date }
