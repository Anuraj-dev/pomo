package com.pomo.sync.transport

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

internal class OkHttpWebDavClient(
    private val baseUrl: String,
    private val authorization: String,
    private val client: OkHttpClient =
        OkHttpClient.Builder()
            .callTimeout(15, TimeUnit.SECONDS)
            .build(),
) : ImmutableMailboxClient {
    override fun createIfAbsent(
        objectId: String,
        bytes: ByteArray,
    ): Boolean {
        val response =
            client.newCall(
                Request.Builder()
                    .url(objectUrl(objectId))
                    .header("Authorization", authorization)
                    .header("If-None-Match", "*")
                    .put(bytes.toRequestBody(OCTET_STREAM))
                    .build(),
            ).execute()
        response.use {
            if (it.code == 412) return false
            if (!it.isSuccessful) error("WEBDAV_${it.code}")
            return true
        }
    }

    override fun get(objectId: String): ByteArray? {
        val response =
            client.newCall(
                Request.Builder()
                    .url(objectUrl(objectId))
                    .header("Authorization", authorization)
                    .header("Cache-Control", "no-cache")
                    .get()
                    .build(),
            ).execute()
        response.use {
            if (it.code == 404) return null
            if (!it.isSuccessful) error("WEBDAV_${it.code}")
            return it.body?.bytes()
        }
    }

    override fun put(
        objectId: String,
        bytes: ByteArray,
    ) {
        val response =
            client.newCall(
                Request.Builder()
                    .url(objectUrl(objectId))
                    .header("Authorization", authorization)
                    .put(bytes.toRequestBody(OCTET_STREAM))
                    .build(),
            ).execute()
        response.use {
            if (!it.isSuccessful) error("WEBDAV_${it.code}")
        }
    }

    private fun objectUrl(objectId: String): String {
        val root = if (baseUrl.endsWith("/")) baseUrl else "$baseUrl/"
        return root + java.net.URLEncoder.encode(objectId, Charsets.UTF_8.name())
    }

    private companion object {
        val OCTET_STREAM = "application/octet-stream".toMediaType()
    }
}
