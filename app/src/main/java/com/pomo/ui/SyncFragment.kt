package com.pomo.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import com.pomo.MainActivity
import com.pomo.sync.ui.SyncSafetyGate
import com.pomo.sync.ui.scheduleOrdinaryDrain
import com.pomo.ui.screens.SyncScreen
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.ThemeMode

public class SyncFragment : Fragment() {
    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View =
        ComposeView(requireContext()).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                PomoTheme(mode = (activity as? MainActivity)?.prefs?.themeMode ?: ThemeMode.System) {
                    var state by remember { mutableStateOf(SyncSafetyGate.state) }
                    SyncScreen(
                        state = state,
                        onRetry = {
                            state = scheduleOrdinaryDrain(state)
                            SyncSafetyGate.state = state
                        },
                        onResumeAdmission = {},
                        onResumeMigration = {},
                        onConfirmRecovery = {},
                    )
                }
            }
        }
}
