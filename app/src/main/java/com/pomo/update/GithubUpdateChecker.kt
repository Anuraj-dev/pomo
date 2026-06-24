package com.pomo.update

import com.google.gson.JsonParser
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/** A release asset as exposed by the GitHub API, reduced to the fields we read. */
internal data class ReleaseAsset(val name: String, val downloadUrl: String)

/**
 * Queries the latest stable GitHub release for the Pomo repo and decides whether the
 * installed build is behind it. Manual, one-shot; no caching or background polling.
 */
internal class GithubUpdateChecker(
    private val client: OkHttpClient,
    private val repo: String = DEFAULT_REPO,
) {

    suspend fun check(currentVersionName: String): UpdateCheckResult = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("https://api.github.com/repos/$repo/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", USER_AGENT)
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (response.code == 403 && response.header("X-RateLimit-Remaining") == "0") {
                    return@withContext UpdateCheckResult.RateLimited
                }
                if (!response.isSuccessful) {
                    return@withContext UpdateCheckResult.MalformedMetadata
                }
                val body = response.body?.string() ?: return@withContext UpdateCheckResult.MalformedMetadata
                parseRelease(body)?.let { (tag, notes, assets) ->
                    resolveUpdate(currentVersionName, tag, notes, assets)
                } ?: UpdateCheckResult.MalformedMetadata
            }
        } catch (_: IOException) {
            UpdateCheckResult.Offline
        }
    }

    private fun parseRelease(json: String): Triple<String?, String, List<ReleaseAsset>>? = try {
        val root = JsonParser.parseString(json).asJsonObject
        val tag = root.get("tag_name")?.takeUnless { it.isJsonNull }?.asString
        val notes = root.get("body")?.takeUnless { it.isJsonNull }?.asString.orEmpty()
        val assets = root.getAsJsonArray("assets")?.mapNotNull { element ->
            val obj = element.asJsonObject
            val name = obj.get("name")?.takeUnless { it.isJsonNull }?.asString ?: return@mapNotNull null
            val url = obj.get("browser_download_url")?.takeUnless { it.isJsonNull }?.asString
                ?: return@mapNotNull null
            ReleaseAsset(name, url)
        }.orEmpty()
        Triple(tag, notes, assets)
    } catch (_: Exception) {
        null
    }

    internal companion object {
        const val DEFAULT_REPO: String = "Snehit70/pomo"
    }
}

/**
 * Pure decision: given the installed version and the raw release fields, decide the
 * result. Extracted from any I/O so it can be unit tested.
 */
internal fun resolveUpdate(
    currentVersionName: String,
    tagName: String?,
    releaseNotes: String,
    assets: List<ReleaseAsset>,
): UpdateCheckResult {
    val current = SemVer.parseOrNull(currentVersionName) ?: return UpdateCheckResult.MalformedMetadata
    val tag = tagName?.takeIf { it.isNotBlank() } ?: return UpdateCheckResult.MalformedMetadata
    val latest = SemVer.parseOrNull(tag) ?: return UpdateCheckResult.MalformedMetadata

    if (latest <= current) return UpdateCheckResult.UpToDate

    val apk = assets.firstOrNull { it.name.endsWith(".apk", ignoreCase = true) }
        ?: return UpdateCheckResult.MissingAsset
    val sha = assets.firstOrNull { it.name.endsWith(".apk.sha256", ignoreCase = true) }

    return UpdateCheckResult.UpdateAvailable(
        LatestRelease(
            versionName = tag.trim().removePrefix("v").removePrefix("V"),
            apkUrl = apk.downloadUrl,
            sha256Url = sha?.downloadUrl,
            releaseNotes = releaseNotes,
        ),
    )
}

internal const val USER_AGENT: String = "Pomo-Android-Updater"
