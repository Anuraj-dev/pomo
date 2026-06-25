package com.pomo.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import androidx.preference.PreferenceManager
import com.google.android.material.transition.MaterialSharedAxis
import com.pomo.ui.screens.ReleaseNotesScreen
import com.pomo.ui.theme.PomoTheme
import com.pomo.ui.theme.themeMode

public class ReleaseNotesFragment : Fragment() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enterTransition = MaterialSharedAxis(MaterialSharedAxis.Z, true)
        returnTransition = MaterialSharedAxis(MaterialSharedAxis.Z, false)
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?,
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            PomoTheme(mode = PreferenceManager.getDefaultSharedPreferences(requireContext()).themeMode()) {
                ReleaseNotesScreen()
            }
        }
    }
}
