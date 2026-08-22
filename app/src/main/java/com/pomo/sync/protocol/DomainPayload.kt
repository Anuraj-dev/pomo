package com.pomo.sync.protocol

internal enum class DomainKind(
    val id: Int,
) {
    PREFERENCE(1),
    HISTORY(2),
    TAG(3),
    PROFILE(4),
    CREW(5),
    TIMER(6),
    ;

    companion object {
        fun of(id: Int): DomainKind? = entries.find { it.id == id }
    }
}

internal object DomainPayload {
    fun requireValid(
        kind: Int,
        payload: ByteArray,
    ) {
        when (DomainKind.of(kind)) {
            DomainKind.PREFERENCE -> OperationCodec.decodePreference(payload)
            DomainKind.HISTORY -> decodeHistory(payload)
            DomainKind.TAG -> decodeTag(payload)
            DomainKind.PROFILE -> decodeProfile(payload)
            DomainKind.CREW -> decodeCrew(payload)
            DomainKind.TIMER -> decodeTimer(payload)
            null -> DeterministicCbor.decodeCanonical(payload)
        }
    }

    fun encodeHistory(action: String, blockId: String, fields: List<String>): ByteArray {
        require(action in setOf("CREATE", "CORRECT", "TOMBSTONE", "SETTLE"))
        require(blockId.isNotBlank())
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(DomainKind.HISTORY.id.toLong()),
                    CborValue.Text(action),
                    CborValue.Text(blockId),
                    CborValue.Array(fields.map { CborValue.Text(it) }),
                ),
            ),
        )
    }

    fun decodeHistory(payload: ByteArray): Triple<String, String, List<String>> {
        val fields = array(payload, 4, DomainKind.HISTORY.id)
        val action = text(fields[1])
        val blockId = text(fields[2])
        val details =
            (fields[3] as? CborValue.Array)?.values?.map { text(it) }
                ?: throw IllegalArgumentException("History details must be an array")
        require(action in setOf("CREATE", "CORRECT", "TOMBSTONE", "SETTLE"))
        require(blockId.isNotBlank())
        return Triple(action, blockId, details)
    }

    fun encodeTag(
        tagId: String,
        name: String,
        paletteSlot: Long,
        archived: Boolean,
        mergedInto: String?,
    ): ByteArray {
        require(tagId.isNotBlank() && name.isNotBlank() && paletteSlot >= 0)
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(DomainKind.TAG.id.toLong()),
                    CborValue.Text(tagId),
                    CborValue.Text(name),
                    CborValue.Integer(paletteSlot),
                    CborValue.Boolean(archived),
                    mergedInto?.let { CborValue.Text(it) } ?: CborValue.Null,
                ),
            ),
        )
    }

    fun decodeTag(payload: ByteArray): Triple<String, String, Boolean> {
        val fields = array(payload, 6, DomainKind.TAG.id)
        val tagId = text(fields[1])
        val name = text(fields[2])
        require(unsigned(fields[3]) >= 0)
        val archived = (fields[4] as? CborValue.Boolean)?.value ?: error("archived")
        return Triple(tagId, name, archived)
    }

    fun encodeProfile(
        name: String,
        photoBlobId: String?,
    ): ByteArray {
        require(name.isNotBlank())
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(DomainKind.PROFILE.id.toLong()),
                    CborValue.Text(name),
                    photoBlobId?.let { CborValue.Text(it) } ?: CborValue.Null,
                ),
            ),
        )
    }

    fun decodeProfile(payload: ByteArray): Pair<String, String?> {
        val fields = array(payload, 3, DomainKind.PROFILE.id)
        return text(fields[1]) to optionalText(fields[2])
    }

    fun encodeCrew(
        crewId: String,
        join: Boolean,
    ): ByteArray {
        require(crewId.isNotBlank())
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(DomainKind.CREW.id.toLong()),
                    CborValue.Text(crewId),
                    CborValue.Boolean(join),
                ),
            ),
        )
    }

    fun decodeCrew(payload: ByteArray): Pair<String, Boolean> {
        val fields = array(payload, 3, DomainKind.CREW.id)
        val join = (fields[2] as? CborValue.Boolean)?.value ?: error("crew intent")
        return text(fields[1]) to join
    }

    fun encodeTimer(
        action: String,
        phaseId: String,
        parentHeads: List<String>,
        ownerDeviceId: String,
        ownershipClaimId: String,
    ): ByteArray {
        require(action.isNotBlank() && phaseId.isNotBlank() && ownerDeviceId.isNotBlank() && ownershipClaimId.isNotBlank())
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(DomainKind.TIMER.id.toLong()),
                    CborValue.Text(action),
                    CborValue.Text(phaseId),
                    CborValue.Array(parentHeads.map { CborValue.Text(it) }),
                    CborValue.Text(ownerDeviceId),
                    CborValue.Text(ownershipClaimId),
                ),
            ),
        )
    }

    fun decodeTimer(payload: ByteArray): List<String> {
        val fields = array(payload, 6, DomainKind.TIMER.id)
        val parents =
            (fields[3] as? CborValue.Array)?.values?.map { text(it) }
                ?: throw IllegalArgumentException("Timer parents must be an array")
        return listOf(text(fields[1]), text(fields[2])) + parents + listOf(text(fields[4]), text(fields[5]))
    }

    fun preferenceProjectionOrEmpty(kind: Int, payload: ByteArray): Pair<String, String> =
        if (kind == DomainKind.PREFERENCE.id) {
            val preference = OperationCodec.decodePreference(payload)
            preference.key to (preference.value as PreferenceValue.Text).value
        } else {
            "" to ""
        }

    private fun array(
        payload: ByteArray,
        size: Int,
        kind: Int,
    ): List<CborValue> {
        val fields =
            (DeterministicCbor.decodeCanonical(payload) as? CborValue.Array)?.values
                ?: throw IllegalArgumentException("Domain payload must be an array")
        require(fields.size == size && fields[0] == CborValue.Integer(kind.toLong())) {
            "Unsupported domain payload"
        }
        return fields
    }

    private fun text(value: CborValue): String =
        (value as? CborValue.Text)?.value ?: throw IllegalArgumentException("expected text")

    private fun optionalText(value: CborValue): String? =
        when (value) {
            CborValue.Null -> null
            is CborValue.Text -> value.value
            else -> throw IllegalArgumentException("expected text or nil")
        }

    private fun unsigned(value: CborValue): Long {
        val integer = (value as? CborValue.Integer)?.value ?: throw IllegalArgumentException("expected integer")
        require(integer >= 0)
        return integer
    }
}
