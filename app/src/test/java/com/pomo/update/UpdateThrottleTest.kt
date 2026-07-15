package com.pomo.update

import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the pure throttle policy behind [ForegroundUpdateCheck]: when a foreground update
 * check is due, and what a completed check does with each [UpdateCheckResult].
 */
public class UpdateThrottleTest {

    private val now: Long = TimeUnit.DAYS.toMillis(365)
    private val release = LatestRelease(
        versionName = "1.25.0",
        apkUrl = "https://example/apk",
        sha256Url = "https://example/sha",
        releaseNotes = "notes",
    )

    @Test
    public fun isDue_neverChecked_isAlwaysDue() {
        assertTrue(UpdateThrottle.isDue(now = now, lastCheckAt = 0L))
    }

    @Test
    public fun isDue_withinWindow_isNotDue() {
        val last = now - (UpdateThrottle.WINDOW_MS - 1)
        assertFalse(UpdateThrottle.isDue(now = now, lastCheckAt = last))
    }

    @Test
    public fun isDue_exactlyAtWindow_isDue() {
        val last = now - UpdateThrottle.WINDOW_MS
        assertTrue(UpdateThrottle.isDue(now = now, lastCheckAt = last))
    }

    @Test
    public fun isDue_pastWindow_isDue() {
        val last = now - (UpdateThrottle.WINDOW_MS + 1)
        assertTrue(UpdateThrottle.isDue(now = now, lastCheckAt = last))
    }

    @Test
    public fun actionFor_updateAvailable_notifies() {
        assertEquals(
            UpdateCheckAction.NOTIFY,
            UpdateThrottle.actionFor(UpdateCheckResult.UpdateAvailable(release)),
        )
    }

    @Test
    public fun actionFor_definitiveNothingToOffer_recordsOnly() {
        assertEquals(UpdateCheckAction.RECORD_ONLY, UpdateThrottle.actionFor(UpdateCheckResult.UpToDate))
        assertEquals(UpdateCheckAction.RECORD_ONLY, UpdateThrottle.actionFor(UpdateCheckResult.MissingAsset))
    }

    @Test
    public fun actionFor_neverReachedGitHub_isIgnored() {
        assertEquals(UpdateCheckAction.IGNORE, UpdateThrottle.actionFor(UpdateCheckResult.Offline))
        assertEquals(UpdateCheckAction.IGNORE, UpdateThrottle.actionFor(UpdateCheckResult.RateLimited))
        assertEquals(UpdateCheckAction.IGNORE, UpdateThrottle.actionFor(UpdateCheckResult.MalformedMetadata))
    }
}
