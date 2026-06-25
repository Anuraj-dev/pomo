package com.pomo.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.R
import com.pomo.BuildConfig
import com.pomo.ui.components.PomoButton
import com.pomo.ui.components.PomoButtonVariant
import com.pomo.ui.theme.JetBrainsMono
import com.pomo.update.GithubUpdateChecker
import com.pomo.update.ReleaseNotesResult
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

private sealed interface ReleaseNotesUiState {
    data object Loading : ReleaseNotesUiState
    data class Loaded(val versionName: String, val notes: String) : ReleaseNotesUiState
    data object NotFound : ReleaseNotesUiState
    data object Offline : ReleaseNotesUiState
    data object RateLimited : ReleaseNotesUiState
    data object Malformed : ReleaseNotesUiState
}

@Composable
public fun ReleaseNotesScreen() {
    val client = remember {
        OkHttpClient.Builder()
            .callTimeout(60, TimeUnit.SECONDS)
            .build()
    }
    val checker = remember { GithubUpdateChecker(client) }
    var reloadKey by remember { mutableStateOf(0) }
    val state by produceState<ReleaseNotesUiState>(
        initialValue = ReleaseNotesUiState.Loading,
        key1 = reloadKey,
    ) {
        value = ReleaseNotesUiState.Loading
        value = when (val result = checker.releaseNotesFor(BuildConfig.VERSION_NAME)) {
            is ReleaseNotesResult.Found ->
                ReleaseNotesUiState.Loaded(
                    versionName = result.release.versionName,
                    notes = result.release.releaseNotes.trim(),
                )
            ReleaseNotesResult.NotFound -> ReleaseNotesUiState.NotFound
            ReleaseNotesResult.Offline -> ReleaseNotesUiState.Offline
            ReleaseNotesResult.RateLimited -> ReleaseNotesUiState.RateLimited
            ReleaseNotesResult.MalformedMetadata -> ReleaseNotesUiState.Malformed
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
    ) {
        Column(Modifier.padding(start = 20.dp, top = 20.dp, end = 20.dp, bottom = 8.dp)) {
            Text(
                text = stringResource(R.string.release_notes_title),
                style = MaterialTheme.typography.displayMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.release_notes_installed_version, BuildConfig.VERSION_NAME),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LazyColumn(
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                when (val ui = state) {
                    ReleaseNotesUiState.Loading -> ReleaseNotesCard(
                        title = stringResource(R.string.release_notes_loading_title),
                        body = stringResource(R.string.release_notes_loading_body),
                    )
                    is ReleaseNotesUiState.Loaded -> ReleaseNotesCard(
                        title = stringResource(R.string.release_notes_version_title, ui.versionName),
                        body = ui.notes.ifBlank {
                            stringResource(R.string.release_notes_empty_body)
                        },
                        mono = false,
                    )
                    ReleaseNotesUiState.NotFound -> RetryCard(
                        title = stringResource(R.string.release_notes_not_found_title),
                        body = stringResource(
                            R.string.release_notes_not_found_body,
                            BuildConfig.VERSION_NAME,
                        ),
                        onRetry = { reloadKey++ },
                    )
                    ReleaseNotesUiState.Offline -> RetryCard(
                        title = stringResource(R.string.release_notes_offline_title),
                        body = stringResource(R.string.release_notes_offline_body),
                        onRetry = { reloadKey++ },
                    )
                    ReleaseNotesUiState.RateLimited -> RetryCard(
                        title = stringResource(R.string.release_notes_rate_limited_title),
                        body = stringResource(R.string.release_notes_rate_limited_body),
                        onRetry = { reloadKey++ },
                    )
                    ReleaseNotesUiState.Malformed -> RetryCard(
                        title = stringResource(R.string.release_notes_unavailable_title),
                        body = stringResource(R.string.release_notes_unavailable_body),
                        onRetry = { reloadKey++ },
                    )
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun ReleaseNotesCard(title: String, body: String, mono: Boolean = true) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 22.sp,
                fontFamily = if (mono) JetBrainsMono else FontFamily.Default,
            )
        }
    }
}

@Composable
private fun RetryCard(title: String, body: String, onRetry: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                lineHeight = 22.sp,
            )
            Spacer(Modifier.height(14.dp))
            PomoButton(
                onClick = onRetry,
                variant = PomoButtonVariant.Ghost,
            ) {
                Text(stringResource(R.string.release_notes_retry))
            }
        }
    }
}
