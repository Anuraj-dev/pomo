# POMO-SUITE-1 shared conformance corpus

This directory freezes the shared dormant Android/Chrome protocol generation.
Both runtimes consume the same JSON and must agree on canonical bytes, hashes,
validation results, materialization, fault boundaries, and activation envelope.
Nothing in this directory activates production synchronization or changes the
phone protocol, firmware, NodeMCU, or desktop-client authority.

## Tracer operation

`pomo-suite-1.cddl` defines the fixed-position unsigned Operation. Kind 1 is the
shared-preference tracer `[1, "focusDurationMinutes", "25"]`. Kinds 2-6 are
History, Tag, Profile, Crew, and Timer payloads. Unknown kinds stay in the
journal and do not write the preference projection. Payloads are deterministically
encoded and hashed. The unsigned Operation is then deterministically encoded.
Both suite and suite generation are part of that unsigned meaning; the COSE
protected header repeats them and verification requires an exact match.
Its identity is:

```text
SHA-256(CBOR(["Pomo Operation ID", 1, bstr(unsigned-operation)]))
```

The frontier is ordered by the unsigned bytewise `(Device ID, Replica
incarnation ID)` tuple. Locale ordering is forbidden. Integers must be within
each consumer's explicitly checked bounds; neither JavaScript `number`
coercion nor a narrower Kotlin type may change accepted meaning.
Preference keys contain 1 through 128 UTF-8 bytes and values contain at most
4096 UTF-8 bytes. Both runtimes enforce byte length, not UTF-16 code units.

For an understood value, a decoder must validate the strict profile, decode,
re-encode, and compare the original bytes before hashing or verifying a
signature. The profile permits definite-length arrays, maps, byte strings, and
valid UTF-8 text plus bounded non-negative integers and `nil` only where the
CDDL permits it. It rejects non-minimal integers, indefinite items, floats,
duplicate map keys, invalid UTF-8, unregistered tags, and trailing bytes.

The COSE envelope is tagged `COSE_Sign1` (tag 18), has an empty unprotected
map, embeds the canonical unsigned payload, and authenticates `ESP256` (`-9`),
suite 1, suite generation 1, object kind 1, schema 1, and the complete Device
ID under fixed private-use labels `-65537` through `-65541`; the protected
`crit` list requires every one to be understood. Its external AAD is the UTF-8
bytes of `Pomo/Operation/1`. Signatures are
fixed 64-byte big-endian `r || s`; generated signatures are normalized to low-S
and received high-S signatures are rejected.

## Fixture files

- `fixtures/operation.json` freezes the preference payload, unsigned Operation,
  Operation-ID input, identity, and expected materialization.
- `fixtures/primitives.json` contains published HKDF-SHA256, RFC 9180 P-256
  HPKE Base-mode, AES-256-GCM, P-256 ECDSA, and Argon2id constants. The RFC
  6979 signature is normalized to
  the POMO low-S wire rule; its published high-S form is a mandatory rejection.
- `fixtures/negative.json` contains byte-level canonicality, suite-generation,
  signature-shape, and Argon2-profile failures. Consumers must fail closed and
  must not try a legacy algorithm or alternate decoder.
- `fixtures/fault-boundaries.json` enumerates the atomic durability and
  activation crash points exercised by both runtimes.
- `fixtures/system-generation.json` freezes suite, generation, formats,
  authenticated-tombstone deletion, Room history authority, and dormant
  production activation. Gradle prod flavor and the Chrome production package
  read this flag. The physical gate in `activation/physical-matrix.json` must
  be all `PASS_PHYSICAL` before the flag may become true.

Hex is lowercase in this corpus. Empty octet strings are `""`. Fixture-only
private keys are public test material and must never enter a production key
store.

## Authoritative sources

- [RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html), deterministic CBOR.
- [RFC 9052](https://www.rfc-editor.org/rfc/rfc9052.html), COSE_Sign1.
- [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864.html), fully specified
  `ESP256`.
- [RFC 5869 Appendix A.1](https://www.rfc-editor.org/rfc/rfc5869.html#appendix-A.1),
  HKDF-SHA256 test case 1.
- [RFC 6979 Appendix A.2.5](https://www.rfc-editor.org/rfc/rfc6979.html#appendix-A.2.5),
  P-256/SHA-256 `sample` signature.
- [RFC 9180 Appendix A.3.1](https://www.rfc-editor.org/rfc/rfc9180.html#appendix-A.3.1),
  P-256/HKDF-SHA256/AES-128-GCM Base-mode sequence-zero vector.
- [NIST CAVP GCM vectors](https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program/cavp-testing-block-cipher-modes),
  `gcmEncryptExtIV256.rsp`, count 0.
- [RFC 9106 section 5.3](https://www.rfc-editor.org/rfc/rfc9106.html#section-5.3),
  Argon2id primitive vector, and section 7.4 for the exact Pomo 64 MiB profile.

## Scope boundary

The corpus and runtime suites cover canonical/crypto/parser, causal/fork,
revocation/quarantine, Checkpoint/Recovery, migration, timer, deterministic fuzz,
and declared crash boundaries. CI also emits separate host-benchmark and
packaged-runtime structural reports. None of those reports is provider or
physical-device evidence; those categories remain explicitly unmeasured in this
stage.
