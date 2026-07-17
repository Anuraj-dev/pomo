package com.pomo.ui.components

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import com.pomo.crew.CrewValidation
import com.pomo.ui.theme.PomoTokens

@Composable
public fun Avatar(
    avatarBase64: String?,
    displayName: String,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val bitmap =
        remember(avatarBase64) {
            avatarBase64?.let {
                runCatching {
                    val bytes = Base64.decode(it, Base64.DEFAULT)
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    val sample =
                        calculateSampleSize(bounds.outWidth, bounds.outHeight, CrewValidation.MAX_AVATAR_DIMENSION)
                    val options = BitmapFactory.Options().apply { inSampleSize = sample }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                }
                    .getOrNull()
            }
        }
    Box(
        modifier = modifier.size(size).clip(CircleShape).background(PomoTokens.colors.accent),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "$displayName profile photo",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                text = displayName.trim().firstOrNull()?.uppercase() ?: "?",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = androidx.compose.ui.graphics.Color.White,
            )
        }
    }
}

private fun calculateSampleSize(
    width: Int,
    height: Int,
    maxDim: Int,
): Int {
    var sample = 1
    while (width / sample > maxDim || height / sample > maxDim) {
        sample *= 2
    }
    return sample
}
