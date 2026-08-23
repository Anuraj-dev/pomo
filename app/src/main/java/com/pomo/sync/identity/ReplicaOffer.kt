package com.pomo.sync.identity

import org.json.JSONObject

internal data class ReplicaOffer(
    val memberId: String,
    val admissionId: String,
    val identityDeviceId: String,
    val lanDeviceId: String,
    val transcriptHash: String,
    val endpoint: String?,
) {
    fun encode(): String =
        JSONObject()
            .put("schema", SCHEMA)
            .put("kind", KIND)
            .put("memberId", memberId)
            .put("admissionId", admissionId)
            .put("identityDeviceId", identityDeviceId)
            .put("lanDeviceId", lanDeviceId)
            .put("transcriptHash", transcriptHash)
            .put("endpoint", endpoint ?: JSONObject.NULL)
            .toString()

    companion object {
        const val SCHEMA: Int = 1
        const val KIND: String = "pomo-replica-offer"

        fun decode(raw: String): ReplicaOffer {
            val value = JSONObject(raw.trim())
            require(value.getInt("schema") == SCHEMA) { "unexpected replica offer schema" }
            require(value.getString("kind") == KIND) { "unexpected replica offer" }
            val endpoint =
                if (value.isNull("endpoint")) {
                    null
                } else {
                    value.optString("endpoint").ifBlank { null }
                }
            return ReplicaOffer(
                hex(value.getString("memberId"), "memberId"),
                hex(value.getString("admissionId"), "admissionId"),
                hex(value.getString("identityDeviceId"), "identityDeviceId"),
                hex(value.getString("lanDeviceId"), "lanDeviceId"),
                hex(value.getString("transcriptHash"), "transcriptHash"),
                endpoint,
            )
        }

        private fun hex(
            value: String,
            name: String,
        ): String {
            require(value.matches(Regex("[0-9a-f]{64}"))) { "$name must be 32-byte hex" }
            return value
        }
    }
}
