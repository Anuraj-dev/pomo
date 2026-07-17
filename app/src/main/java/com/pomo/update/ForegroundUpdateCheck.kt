package com.pomo.update

import com.pomo.notifications.AlertsNotifier
import com.pomo.util.UtilPreferenceManager
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * The unattended half of update checking. Where [com.pomo.ui.screens.UpdateSection] is the manual
 * "Check for updates" button, this runs on app foreground, at most once per 24h, and — if a newer
 * version is out — posts a single quiet notification. It never downloads or installs; the member
 * still drives that from the update section.
 *
 * The throttle window only advances on a *definitive online answer*. An offline or rate-limited
 * attempt is not counted, so a member who was briefly disconnected gets a real check next foreground
 * rather than waiting out a full day. The two decisions — is a check due, and what to do with its
 * result — live in [UpdateThrottle] so they can be unit-tested without Android.
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
        if (!UpdateThrottle.isDue(now, prefs.lastUpdateCheckAt)) return

        val result = checker.check(currentVersionName)
        val newVersionName = (result as? UpdateCheckResult.UpdateAvailable)?.release?.versionName
        when (UpdateThrottle.actionFor(result)) {
            UpdateCheckAction.NOTIFY -> {
                prefs.lastUpdateCheckAt = now
                newVersionName?.let { notifier.notifyUpdate(it) }
            }
            // Reached GitHub and got a real answer, just nothing to offer — count it against the window.
            UpdateCheckAction.RECORD_ONLY -> prefs.lastUpdateCheckAt = now
            // Never reached a real answer; leave the window untouched so the next foreground retries.
            UpdateCheckAction.IGNORE -> Unit
        }
    }

    companion object {
        private fun defaultClient(): OkHttpClient =
            OkHttpClient.Builder()
                .callTimeout(30, TimeUnit.SECONDS)
                .build()
    }
}

/** What a completed foreground check should do with its result. */
internal enum class UpdateCheckAction { NOTIFY, RECORD_ONLY, IGNORE }

/** Pure throttle policy for [ForegroundUpdateCheck], extracted so it is unit-testable without Android. */
internal object UpdateThrottle {
    val WINDOW_MS: Long = TimeUnit.HOURS.toMillis(24)

    /**
     * Whether a foreground check is due. [lastCheckAt] of 0 means "never checked", which is always
     * due; otherwise a check is due once [WINDOW_MS] has elapsed.
     */
    fun isDue(
        now: Long,
        lastCheckAt: Long,
    ): Boolean = lastCheckAt == 0L || now - lastCheckAt >= WINDOW_MS

    /**
     * What to do with a completed check: [UpdateCheckAction.NOTIFY] and record the time when a newer
     * version exists, [UpdateCheckAction.RECORD_ONLY] on a definitive "nothing to offer" answer, or
     * [UpdateCheckAction.IGNORE] — leaving the window untouched — when GitHub was never really reached.
     */
    fun actionFor(result: UpdateCheckResult): UpdateCheckAction =
        when (result) {
            is UpdateCheckResult.UpdateAvailable -> UpdateCheckAction.NOTIFY
            UpdateCheckResult.UpToDate,
            UpdateCheckResult.MissingAsset,
            -> UpdateCheckAction.RECORD_ONLY
            UpdateCheckResult.Offline,
            UpdateCheckResult.RateLimited,
            UpdateCheckResult.MalformedMetadata,
            -> UpdateCheckAction.IGNORE
        }
}
