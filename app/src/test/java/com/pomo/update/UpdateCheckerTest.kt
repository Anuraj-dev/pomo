package com.pomo.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

public class UpdateCheckerTest {
    private val apk = ReleaseAsset("pomo-1.25.0-dev-debug.apk", "https://example/apk")
    private val sha = ReleaseAsset("pomo-1.25.0-dev-debug.apk.sha256", "https://example/sha")

    @Test
    public fun semver_parsesAndIgnoresPrereleaseSuffix() {
        assertEquals(SemVer(1, 24, 2), SemVer.parseOrNull("v1.24.2"))
        assertEquals(SemVer(1, 24, 2), SemVer.parseOrNull("1.24.2-demo"))
        assertEquals(SemVer(1, 24, 0), SemVer.parseOrNull("1.24"))
        assertNull(SemVer.parseOrNull("not-a-version"))
        assertNull(SemVer.parseOrNull("1.2.3.4"))
    }

    @Test
    public fun semver_ordersNumericallyNotLexically() {
        assertTrue(SemVer.parseOrNull("1.9.0")!! < SemVer.parseOrNull("1.10.0")!!)
        assertTrue(SemVer.parseOrNull("2.0.0")!! > SemVer.parseOrNull("1.99.99")!!)
    }

    @Test
    public fun resolve_newerTag_returnsAvailableWithApkAndSha() {
        val result = resolveUpdate("1.24.2", "v1.25.0", "notes", listOf(apk, sha))
        assertTrue(result is UpdateCheckResult.UpdateAvailable)
        val release = (result as UpdateCheckResult.UpdateAvailable).release
        assertEquals("1.25.0", release.versionName)
        assertEquals("https://example/apk", release.apkUrl)
        assertEquals("https://example/sha", release.sha256Url)
    }

    @Test
    public fun resolve_demoSuffixOnCurrent_stillComparesBaseVersion() {
        assertEquals(
            UpdateCheckResult.UpToDate,
            resolveUpdate("1.25.0-demo", "v1.25.0", "", listOf(apk)),
        )
    }

    @Test
    public fun resolve_sameOrOlderTag_isUpToDate() {
        assertEquals(UpdateCheckResult.UpToDate, resolveUpdate("1.24.2", "v1.24.2", "", listOf(apk)))
        assertEquals(UpdateCheckResult.UpToDate, resolveUpdate("1.24.2", "v1.23.0", "", listOf(apk)))
    }

    @Test
    public fun resolve_newerTagButNoApkAsset_isMissingAsset() {
        assertEquals(
            UpdateCheckResult.MissingAsset,
            resolveUpdate("1.24.2", "v1.25.0", "", listOf(sha)),
        )
    }

    @Test
    public fun resolve_blankOrUnparseableTag_isMalformed() {
        assertEquals(UpdateCheckResult.MalformedMetadata, resolveUpdate("1.24.2", null, "", listOf(apk)))
        assertEquals(UpdateCheckResult.MalformedMetadata, resolveUpdate("1.24.2", "  ", "", listOf(apk)))
        assertEquals(UpdateCheckResult.MalformedMetadata, resolveUpdate("1.24.2", "latest", "", listOf(apk)))
    }
}
