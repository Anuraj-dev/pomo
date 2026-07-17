package com.pomo.profile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.max

/** Owns the small, compressed avatar that is attached to the member identity. */
public class AvatarStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    public fun encoded(): String? = prefs.getString(KEY_AVATAR, null)

    public fun clear() {
        prefs.edit().remove(KEY_AVATAR).apply()
    }

    public fun restore(encoded: String?) {
        if (encoded == null) {
            clear()
            return
        }
        runCatching { Base64.decode(encoded, Base64.DEFAULT) }
            .getOrNull()
            ?.takeIf { it.size <= MAX_AVATAR_BYTES }
            ?.let { prefs.edit().putString(KEY_AVATAR, encoded).apply() }
    }

    /** Compresses a picked image and persists its transport-safe Base64 representation. */
    public fun importImage(
        context: Context,
        uri: Uri,
    ): String? {
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val sample = calculateSample(bounds.outWidth, bounds.outHeight)
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
        val image = scale(decoded)
        val compressed = compress(image)
        if (image !== decoded) image.recycle()
        decoded.recycle()
        if (compressed == null) return null
        val encoded = Base64.encodeToString(compressed, Base64.NO_WRAP)
        prefs.edit().putString(KEY_AVATAR, encoded).apply()
        return encoded
    }

    private fun compress(bitmap: Bitmap): ByteArray? {
        for (quality in intArrayOf(72, 58, 45, 32)) {
            val output = ByteArrayOutputStream()
            if (!bitmap.compress(Bitmap.CompressFormat.WEBP, quality, output)) continue
            val bytes = output.toByteArray()
            if (bytes.size <= MAX_AVATAR_BYTES) return bytes
        }
        return null
    }

    private fun scale(bitmap: Bitmap): Bitmap {
        val largest = max(bitmap.width, bitmap.height)
        if (largest <= MAX_DIMENSION) return bitmap
        val ratio = MAX_DIMENSION.toFloat() / largest
        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * ratio).toInt().coerceAtLeast(1),
            (bitmap.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
    }

    private fun calculateSample(
        width: Int,
        height: Int,
    ): Int {
        var sample = 1
        while (max(width / sample, height / sample) > MAX_DECODE_DIMENSION) sample *= 2
        return sample
    }

    private companion object {
        private const val PREFS_NAME = "profile_avatar_prefs"
        private const val KEY_AVATAR = "avatar_base64"
        private const val MAX_DIMENSION = 256
        private const val MAX_DECODE_DIMENSION = 1024
        private const val MAX_AVATAR_BYTES = 10 * 1024
    }
}
