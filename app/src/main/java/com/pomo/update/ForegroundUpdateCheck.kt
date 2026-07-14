package com.pomo.update

import com.pomo.notifications.AlertsNotifier
import com.pomo.util.UtilPreferenceManager
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/**
 * The unattended half of update checking. Where [com.pomo.ui.screens.UpdateSection] is the manual
 * "Check for updates" button, this runs on app foreground, at most once per 24h, and — if a newer
 * version is out — posts a single quiet notification. It never downloads or installs; the member
 * still drives that from the update section.
 *
 * The throttle window only advances on a *definitive online answer*. An offline or rate-limited
 * attempt is not counted, so a member who was briefly disconnected gets a real check next foreground
 * rather than waiting out a full day.
 */
internal class ForegroundUpdateCheck(
    private val checker: GithubUpdateChecker = GithubUpdateChecker(defaultClient()),
) {

    suspend fun runIfDue(
        prefs: UtilPreferenceManager,
        currentVersionName: String,
        notifier: AlertsNotifier,
    ) {
        val now = System.currentTimeMillis()
        val last = prefs.lastUpdateCheckAt
        if (last != 0L && now - last < THROTTLE_MS) return

        when (val result = checker.check(currentVersionName)) {
            is UpdateCheckResult.UpdateAvailable -> {
                prefs.lastUpdateCheckAt = now
                notifier.notifyUpdate(result.release.versionName)
            }
            // Reached GitHub and got a real answer, just nothing to offer — count it against the window.
            UpdateCheckResult.UpToDate,
            UpdateCheckResult.MissingAsset,
            -> prefs.lastUpdateCheckAt = now
            // Never reached a real answer; leave the window untouched so the next foreground retries.
            UpdateCheckResult.Offline,
            UpdateCheckResult.RateLimited,
            UpdateCheckResult.MalformedMetadata,
            -> Unit
        }
    }

    companion object {
        private val THROTTLE_MS: Long = TimeUnit.HOURS.toMillis(24)

        private fun defaultClient(): OkHttpClient =
            OkHttpClient.Builder()
                .callTimeout(30, TimeUnit.SECONDS)
                .build()
    }
}
