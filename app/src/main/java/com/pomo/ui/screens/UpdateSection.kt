package com.pomo.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pomo.BuildConfig
import com.pomo.ui.components.PomoButton
import com.pomo.ui.components.PomoButtonVariant
import com.pomo.update.ApkInstaller
import com.pomo.update.DownloadOutcome
import com.pomo.update.GithubUpdateChecker
import com.pomo.update.LatestRelease
import com.pomo.update.UpdateCheckResult
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

private sealed interface UpdateUiState {
    data object Idle : UpdateUiState
    data object Checking : UpdateUiState
    data object UpToDate : UpdateUiState
    data class Available(val release: LatestRelease) : UpdateUiState
    data class Downloading(val release: LatestRelease, val progress: Float) : UpdateUiState
    data object Installing : UpdateUiState
    data class Failed(val message: String, val canOpenSettings: Boolean = false) : UpdateUiState
}

/**
 * The manual "Check for updates" card for the About screen. Hosts its own state (the
 * codebase has no ViewModel layer); pure logic lives in [GithubUpdateChecker] and
 * [ApkInstaller]. Callers gate this to the canonical build — the `.demo` build hides it.
 */
@Composable
internal fun UpdateSection(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val client = remember {
        OkHttpClient.Builder()
            .callTimeout(60, TimeUnit.SECONDS)
            .build()
    }
    val checker = remember { GithubUpdateChecker(client) }
    val installer = remember(context) { ApkInstaller(client, context.cacheDir) }
    var state by remember { mutableStateOf<UpdateUiState>(UpdateUiState.Idle) }

    fun check() {
        state = UpdateUiState.Checking
        scope.launch {
            state = when (val result = checker.check(BuildConfig.VERSION_NAME)) {
                is UpdateCheckResult.UpdateAvailable -> UpdateUiState.Available(result.release)
                UpdateCheckResult.UpToDate -> UpdateUiState.UpToDate
                UpdateCheckResult.Offline ->
                    UpdateUiState.Failed("No connection. Check your network and try again.")
                UpdateCheckResult.RateLimited ->
                    UpdateUiState.Failed("GitHub rate limit reached. Try again later.")
                UpdateCheckResult.MalformedMetadata ->
                    UpdateUiState.Failed("Couldn't read the latest release. Try again later.")
                UpdateCheckResult.MissingAsset ->
                    UpdateUiState.Failed("The latest release has no installable file yet.")
            }
        }
    }

    fun install(release: LatestRelease) {
        if (!ApkInstaller.canInstall(context)) {
            state = UpdateUiState.Failed(
                "Allow Pomo to install apps, then try again.",
                canOpenSettings = true,
            )
            return
        }
        scope.launch {
            state = UpdateUiState.Downloading(release, 0f)
            val outcome = installer.download(release) { progress ->
                state = UpdateUiState.Downloading(release, progress)
            }
            state = when (outcome) {
                is DownloadOutcome.Ready -> {
                    if (ApkInstaller.canInstall(context)) {
                        ApkInstaller.launchInstaller(context, outcome.apk)
                        UpdateUiState.Installing
                    } else {
                        UpdateUiState.Failed(
                            "Allow Pomo to install apps, then try again.",
                            canOpenSettings = true,
                        )
                    }
                }
                DownloadOutcome.Offline ->
                    UpdateUiState.Failed("Download interrupted. Check your network and try again.")
                DownloadOutcome.Corrupt ->
                    UpdateUiState.Failed("Download was corrupted. Try again.")
                DownloadOutcome.Failed ->
                    UpdateUiState.Failed("Download failed. Try again.")
            }
        }
    }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                "Updates",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(12.dp))

            when (val s = state) {
                UpdateUiState.Idle -> {
                    StatusText("You're on version ${BuildConfig.VERSION_NAME}.")
                    Spacer(Modifier.height(12.dp))
                    PomoButton(onClick = ::check) { Text("Check for updates") }
                }

                UpdateUiState.Checking -> {
                    StatusText("Checking for updates…")
                    Spacer(Modifier.height(12.dp))
                    PomoButton(onClick = {}, enabled = false, loading = true) { Text("Checking") }
                }

                UpdateUiState.UpToDate -> {
                    StatusText("You're on the latest version (${BuildConfig.VERSION_NAME}).")
                    Spacer(Modifier.height(12.dp))
                    PomoButton(onClick = ::check, variant = PomoButtonVariant.Ghost) {
                        Text("Check again")
                    }
                }

                is UpdateUiState.Available -> {
                    StatusText(
                        "Version ${s.release.versionName} is available.",
                        emphasis = true,
                    )
                    if (s.release.releaseNotes.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        ReleaseNotes(s.release.releaseNotes)
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PomoButton(onClick = { install(s.release) }) { Text("Download & install") }
                        PomoButton(
                            onClick = { state = UpdateUiState.Idle },
                            variant = PomoButtonVariant.Ghost,
                        ) { Text("Later") }
                    }
                }

                is UpdateUiState.Downloading -> {
                    StatusText("Downloading version ${s.release.versionName}…")
                    Spacer(Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = { s.progress },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    StatusText("${(s.progress * 100).toInt()}%")
                }

                UpdateUiState.Installing -> {
                    StatusText("Opening the installer…")
                }

                is UpdateUiState.Failed -> {
                    StatusText(s.message)
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (s.canOpenSettings) {
                            PomoButton(onClick = { ApkInstaller.openInstallPermissionSettings(context) }) {
                                Text("Open settings")
                            }
                        }
                        PomoButton(onClick = ::check, variant = PomoButtonVariant.Ghost) {
                            Text("Try again")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusText(text: String, emphasis: Boolean = false) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium,
        color = if (emphasis) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
    )
}

@Composable
private fun ReleaseNotes(notes: String) {
    val scroll = rememberScrollState()
    Text(
        text = notes.trim(),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        lineHeight = 18.sp,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 160.dp)
            .verticalScroll(scroll),
    )
}
