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
import androidx.lifecycle.lifecycleScope
import androidx.navigation.fragment.findNavController
import com.google.android.material.transition.MaterialFadeThrough
import com.pomo.MainActivity
import com.pomo.R
import com.pomo.crew.CrewIdentityStore
import com.pomo.crew.CrewRepository
import com.pomo.db.HistoryCacheRepository
import com.pomo.profile.KeyFingerprint
import com.pomo.profile.ProfileStore
import com.pomo.stats.StatsAggregator
import com.pomo.stats.StatsSnapshot
import com.pomo.ui.screens.ProfileScreen
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.ThemeMode
import com.pomo.util.DateLogic
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch

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
                    var name by displayName

                    ProfileScreen(
                        displayName = name,
                        keyFingerprint = fingerprint,
                        lifetimeFocusMinutes = snapshot.lifetime.focusMinutes,
                        currentStreak = snapshot.habit.currentStreak,
                        blocks = snapshot.lifetime.sessions,
                        onDisplayNameChange = { requested ->
                            profileStore.updateDisplayName(requested)?.let { saved ->
                                name = saved
                                // Crews read the name off their membership rows and only learn of a
                                // change when a snapshot is published, so the rename goes through the
                                // repository rather than straight into CrewStore.
                                viewLifecycleOwner.lifecycleScope.launch {
                                    CrewRepository(ctx).updateDisplayName(saved)
                                }
                            }
                        },
                        onOpenSettings = {
                            findNavController().navigate(R.id.navigation_settings)
                        },
                    )
                }
            }
        }
    }

    /** The streak has to keep up with the calendar while the screen is open, as Stats does. */
    private fun currentDateFlow(): Flow<String> = flow {
        while (true) {
            emit(DateLogic.effectiveDate(System.currentTimeMillis()))
            delay(DATE_REFRESH_INTERVAL_MS)
        }
    }.distinctUntilChanged()
}

private const val DEFAULT_DAILY_GOAL: Int = 8
private const val DATE_REFRESH_INTERVAL_MS: Long = 60_000L
