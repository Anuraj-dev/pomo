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
import androidx.navigation.fragment.findNavController
import com.google.android.material.transition.MaterialFadeThrough
import com.pomo.MainActivity
import com.pomo.achievements.AchievementEvaluator
import com.pomo.db.HistoryCacheRepository
import com.pomo.stats.StatsAggregator
import com.pomo.stats.StatsSnapshot
import com.pomo.ui.screens.AchievementsScreen
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.ThemeMode
import com.pomo.util.DateLogic
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow

/**
 * Your achievements page. Like Profile and Stats, it derives everything from Room on read — there is
 * no achievements table and nothing is persisted. See docs/adr/0005-achievements.md.
 */
public class AchievementsFragment : Fragment() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enterTransition = MaterialFadeThrough()
        exitTransition = MaterialFadeThrough()
    }

    private val mainActivity: MainActivity?
        get() = activity as? MainActivity

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View {
        val ctx = requireContext()
        val repo = HistoryCacheRepository(ctx)

        val snapshotFlow: Flow<StatsSnapshot> =
            combine(
                repo.observeDayStats(),
                repo.observeAllSessions(),
                currentDateFlow(),
            ) { days, sessions, today ->
                StatsAggregator.aggregate(
                    days = days,
                    sessions = sessions,
                    dailyGoal = mainActivity?.prefs?.dailyGoal ?: DEFAULT_DAILY_GOAL,
                    today = today,
                    nowMs = System.currentTimeMillis(),
                )
            }

        return ComposeView(ctx).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                PomoTheme(mode = mainActivity?.prefs?.themeMode ?: ThemeMode.System) {
                    val snapshot by snapshotFlow.collectAsState(initial = StatsSnapshot.Empty)
                    AchievementsScreen(
                        statuses = AchievementEvaluator.evaluate(snapshot),
                        onBack = { findNavController().popBackStack() },
                    )
                }
            }
        }
    }

    /** Keep the streak-driven tiles current across midnight while the page is open, as Stats does. */
    private fun currentDateFlow(): Flow<String> = flow {
        while (true) {
            emit(DateLogic.effectiveDate(System.currentTimeMillis()))
            delay(DATE_REFRESH_INTERVAL_MS)
        }
    }.distinctUntilChanged()
}

private const val DEFAULT_DAILY_GOAL: Int = 8
private const val DATE_REFRESH_INTERVAL_MS: Long = 60_000L
