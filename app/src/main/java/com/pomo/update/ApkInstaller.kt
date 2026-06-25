package com.pomo.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Downloads a release APK into app-private cache, verifies it against the published
 * sha256, and hands it to the system package installer. Only ever used on the
 * canonical `com.pomo` build (the `.demo` build hides the updater entirely).
 */
internal class ApkInstaller(
    private val client: OkHttpClient,
    private val cacheDir: File,
) {

    suspend fun download(
        release: LatestRelease,
        onProgress: (Float) -> Unit,
    ): DownloadOutcome = withContext(Dispatchers.IO) {
        try {
            val dir = File(cacheDir, UPDATES_DIR).apply { mkdirs() }
            // Only the newest download is ever needed; drop any stragglers first.
            dir.listFiles()?.forEach { it.delete() }
            val apk = File(dir, "pomo-${release.versionName}.apk")

            val request = Request.Builder()
                .url(release.apkUrl)
                .header("User-Agent", USER_AGENT)
                .build()

            client.newCall(request).execute().use { response ->
                val body = response.body
                if (!response.isSuccessful || body == null) return@withContext DownloadOutcome.Failed
                val total = body.contentLength()
                apk.outputStream().use { out ->
                    body.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var downloaded = 0L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            out.write(buffer, 0, read)
                            downloaded += read
                            if (total > 0) onProgress((downloaded.toFloat() / total).coerceIn(0f, 1f))
                        }
                    }
                }
            }

            val expected = release.sha256Url?.let { shaUrl ->
                fetchExpectedSha(shaUrl) ?: run {
                    apk.delete()
                    return@withContext DownloadOutcome.Corrupt
                }
            }
            if (expected != null && !expected.equals(sha256Of(apk), ignoreCase = true)) {
                apk.delete()
                return@withContext DownloadOutcome.Corrupt
            }
            onProgress(1f)
            DownloadOutcome.Ready(apk)
        } catch (_: IOException) {
            DownloadOutcome.Offline
        }
    }

    private fun fetchExpectedSha(url: String): String? {
        val request = Request.Builder().url(url).header("User-Agent", USER_AGENT).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            // Format: "<hex>␠␠<filename>". We only need the leading hex digest.
            return response.body?.string()?.trim()?.substringBefore(' ')?.takeIf { it.isNotEmpty() }
        }
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xFF) }
    }

    internal companion object {
        const val UPDATES_DIR: String = "updates"

        /** Whether the user has granted this app the "install unknown apps" capability. */
        fun canInstall(context: Context): Boolean =
            context.packageManager.canRequestPackageInstalls()

        /** Launch the system installer for a downloaded APK via the shared FileProvider. */
        fun launchInstaller(context: Context, apk: File) {
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }

        /** Send the user to the per-app "install unknown apps" settings screen. */
        fun openInstallPermissionSettings(context: Context) {
            val intent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }
}
