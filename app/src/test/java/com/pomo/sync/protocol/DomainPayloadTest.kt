package com.pomo.sync.protocol

import org.junit.Assert.assertThrows
import org.junit.Test

public class DomainPayloadTest {
    @Test
    public fun tagProfileCrewAndTimerDecodersRejectBlankIdentifiers() {
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeTag(rawTag(tagId = "", name = "Work", mergedInto = null))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeTag(rawTag(tagId = "tag-work", name = "", mergedInto = null))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeTag(rawTag(tagId = "tag-work", name = "Work", mergedInto = ""))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeProfile(
                DeterministicCbor.encode(
                    CborValue.Array(listOf(CborValue.Integer(4), CborValue.Text(""), CborValue.Null)),
                ),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeCrew(
                DeterministicCbor.encode(
                    CborValue.Array(
                        listOf(CborValue.Integer(5), CborValue.Text(""), CborValue.Boolean(true)),
                    ),
                ),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeTimer(
                DeterministicCbor.encode(
                    CborValue.Array(
                        listOf(
                            CborValue.Integer(6),
                            CborValue.Text("START"),
                            CborValue.Text(""),
                            CborValue.Array(emptyList()),
                            CborValue.Text("android"),
                            CborValue.Text("claim-a"),
                        ),
                    ),
                ),
            )
        }
    }

    @Test
    public fun historyAndTimerRejectNonStringArrayElements() {
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeHistory(
                DeterministicCbor.encode(
                    CborValue.Array(
                        listOf(
                            CborValue.Integer(2),
                            CborValue.Text("CREATE"),
                            CborValue.Text("block-1"),
                            CborValue.Array(listOf(CborValue.Integer(1))),
                        ),
                    ),
                ),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            DomainPayload.decodeTimer(
                DeterministicCbor.encode(
                    CborValue.Array(
                        listOf(
                            CborValue.Integer(6),
                            CborValue.Text("START"),
                            CborValue.Text("phase-1"),
                            CborValue.Array(listOf(CborValue.Integer(1))),
                            CborValue.Text("android"),
                            CborValue.Text("claim-a"),
                        ),
                    ),
                ),
            )
        }
    }

    private fun rawTag(
        tagId: String,
        name: String,
        mergedInto: String?,
    ): ByteArray =
        DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(3),
                    CborValue.Text(tagId),
                    CborValue.Text(name),
                    CborValue.Integer(0),
                    CborValue.Boolean(false),
                    mergedInto?.let { CborValue.Text(it) } ?: CborValue.Null,
                ),
            ),
        )
}
