package com.pomo.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.google.android.material.transition.MaterialFadeThrough
import com.pomo.MainActivity
import com.pomo.R
import com.pomo.crew.CrewIdentityStore
import com.pomo.db.HistoryCacheRepository
import com.pomo.profile.KeyFingerprint
import com.pomo.profile.ProfileStore
import com.pomo.stats.StatsAggregator
import com.pomo.stats.StatsSnapshot
import com.pomo.ui.screens.ProfileScreen
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.ThemeMode
import com.pomo.util.DateLogic
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

public class ProfileFragment : Fragment() {

    private val displayName = mutableStateOf("")

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
        val profileStore = ProfileStore(ctx)
        val fingerprint = KeyFingerprint.format(CrewIdentityStore(ctx).publicKey())
        val repo = HistoryCacheRepository(ctx)

        displayName.value = profileStore.displayName()

        val today: String = DateLogic.effectiveDate(System.currentTimeMillis())
        val snapshotFlow: Flow<StatsSnapshot> =
            combine(repo.observeDayStats(), repo.observeAllSessions()) { days, sessions ->
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
                    var name by displayName

                    ProfileScreen(
                        displayName = name,
                        keyFingerprint = fingerprint,
                        lifetimeFocusMinutes = snapshot.lifetime.focusMinutes,
                        currentStreak = snapshot.habit.currentStreak,
                        blocks = snapshot.lifetime.sessions,
                        onDisplayNameChange = { requested ->
                            profileStore.updateDisplayName(requested)?.let { saved -> name = saved }
                        },
                        onOpenSettings = {
                            findNavController().navigate(R.id.navigation_settings)
                        },
                    )
                }
            }
        }
    }
}

private const val DEFAULT_DAILY_GOAL: Int = 8
