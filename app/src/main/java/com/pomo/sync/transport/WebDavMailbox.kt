package com.pomo.sync.transport

import com.pomo.sync.crypto.PomoCrypto

internal data class MailboxObject(
    val objectId: String,
    val bytes: ByteArray,
    val sha256: String,
    val size: Long,
)

internal data class MailboxManifest(
    val manifestId: String,
    val checkpointId: String,
    val packIds: List<String>,
    val operationIds: List<String>,
    val blobIds: List<String>,
)

internal enum class MailboxFailure {
    CORS,
    QUOTA,
    CREDENTIAL,
    ROLLBACK,
    MISSING_OBJECT,
    NETWORK,
}

internal data class MailboxProtection(
    val mailboxId: String,
    val protected: Boolean,
    val failure: MailboxFailure?,
)

internal interface ImmutableMailboxClient {
    fun createIfAbsent(objectId: String, bytes: ByteArray): Boolean
    fun get(objectId: String): ByteArray?
}

internal class WebDavMailbox(
    private val mailboxId: String,
    private val client: ImmutableMailboxClient,
) {
    fun protect(objects: Collection<MailboxObject>): MailboxProtection =
        runCatching {
            objects.forEach { expected ->
                client.createIfAbsent(expected.objectId, expected.bytes.copyOf())
                val retrieved = requireNotNull(client.get(expected.objectId)) { "Mailbox object is missing" }
                require(retrieved.size.toLong() == expected.size)
                require(PomoCrypto.sha256(retrieved).hex() == expected.sha256)
            }
            MailboxProtection(mailboxId, true, null)
        }.getOrElse { MailboxProtection(mailboxId, false, MailboxFailure.NETWORK) }

    fun challenge(expected: MailboxObject): Boolean {
        val bytes = client.get(expected.objectId) ?: return false
        return bytes.size.toLong() == expected.size && PomoCrypto.sha256(bytes).hex() == expected.sha256
    }

    private fun ByteArray.hex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }
}

internal fun repairMailbox(
    source: ImmutableMailboxClient,
    target: ImmutableMailboxClient,
    objectIds: Collection<String>,
): Set<String> {
    val repaired = linkedSetOf<String>()
    objectIds.forEach { id -> source.get(id)?.let { if (target.createIfAbsent(id, it.copyOf())) repaired += id } }
    return repaired
}
