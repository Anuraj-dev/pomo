package com.pomo.sync.identity

import com.pomo.sync.crypto.PomoCrypto
import com.pomo.sync.protocol.CborValue
import com.pomo.sync.protocol.DeterministicCbor
import com.pomo.sync.protocol.PomoSuite
import com.pomo.sync.protocol.ProtocolBytes

internal object IdentityCodec {
    private const val CERTIFICATE_VERSION: Long = 1
    private const val GENESIS_VERSION: Long = 1

    fun encodeDeviceCertificate(certificate: DeviceCertificate): ByteArray {
        requireCertificate(certificate.suite, certificate.signingPublicKey, certificate.agreementPublicKey)
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(CERTIFICATE_VERSION),
                    CborValue.Integer(certificate.suite.toLong()),
                    CborValue.Bytes(certificate.signingPublicKey),
                    CborValue.Bytes(certificate.agreementPublicKey),
                ),
            ),
        )
    }

    fun deviceId(certificate: DeviceCertificate): ProtocolBytes =
        domainId("Pomo Device ID", encodeDeviceCertificate(certificate))

    fun encodeRecoveryCertificate(certificate: RecoveryCertificate): ByteArray {
        requireCertificate(certificate.suite, certificate.signingPublicKey, certificate.agreementPublicKey)
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(CERTIFICATE_VERSION),
                    CborValue.Integer(certificate.suite.toLong()),
                    CborValue.Bytes(certificate.signingPublicKey),
                    CborValue.Bytes(certificate.agreementPublicKey),
                ),
            ),
        )
    }

    fun recoveryId(certificate: RecoveryCertificate): ProtocolBytes =
        domainId("Pomo Recovery ID", encodeRecoveryCertificate(certificate))

    fun encodeGenesis(genesis: MemberGenesis): ByteArray {
        require(genesis.suite == PomoSuite.ID)
        require(genesis.suiteGeneration == PomoSuite.INITIAL_GENERATION)
        require(genesis.recoveryGeneration == 1L)
        return DeterministicCbor.encode(
            CborValue.Array(
                listOf(
                    CborValue.Integer(GENESIS_VERSION),
                    CborValue.Integer(genesis.suite.toLong()),
                    CborValue.Integer(genesis.suiteGeneration),
                    CborValue.Integer(genesis.recoveryGeneration),
                    CborValue.Bytes(encodeRecoveryCertificate(genesis.recoveryCertificate)),
                    CborValue.Bytes(encodeDeviceCertificate(genesis.firstDeviceCertificate)),
                ),
            ),
        )
    }

    fun memberIdentity(genesis: MemberGenesis): MemberIdentity {
        val canonical = encodeGenesis(genesis)
        return MemberIdentity(domainId("Pomo Member ID", canonical), canonical, genesis)
    }

    fun factId(canonicalFact: ByteArray): ProtocolBytes = domainId("Pomo Authority Fact ID", canonicalFact)

    private fun domainId(
        label: String,
        canonical: ByteArray,
    ): ProtocolBytes {
        DeterministicCbor.decodeCanonical(canonical)
        val domain =
            DeterministicCbor.encode(
                CborValue.Array(
                    listOf(
                        CborValue.Text(label),
                        CborValue.Integer(PomoSuite.ID.toLong()),
                        CborValue.Bytes(canonical),
                    ),
                ),
            )
        return ProtocolBytes.of(PomoCrypto.sha256(domain), PomoSuite.ID_BYTES)
    }

    private fun requireCertificate(
        suite: Int,
        signingPublicKey: ByteArray,
        agreementPublicKey: ByteArray,
    ) {
        require(suite == PomoSuite.ID)
        require(signingPublicKey.size == PomoSuite.HPKE_ENCAPSULATED_KEY_BYTES)
        require(agreementPublicKey.size == PomoSuite.HPKE_ENCAPSULATED_KEY_BYTES)
        require(!signingPublicKey.contentEquals(agreementPublicKey)) { "Signing and agreement keys must be distinct" }
    }
}
