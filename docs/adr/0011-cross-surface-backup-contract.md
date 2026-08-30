# ADR-0011: Cross-surface portable backup contract

## Status

Accepted, narrowed by ADR-0012. Chrome still speaks `pomo-backup` v1 for history.
It writes an empty Crew object and ignores Crew on import. Phone backup remains
the Crew-bearing document.

## Decision

The Android Room backup is the shared portable contract for the phone and Chrome
extension. Both surfaces read and write the versioned JSON document identified by
`format: "pomo-backup"` and `version: 1`.

The contract is deliberately the existing Android `PomoBackup` shape:

- `history.dayStats` and `history.sessions` are the canonical local history;
- `crew` contains the identity private key, memberships, and cached Crew projection;
- session identity is its positive `start` epoch-second primary key;
- `crew.memberships[].protocolVersion` must be the active Crew protocol version;
- unknown JSON fields are ignored on import so newer producers do not corrupt older
  surfaces, while unsupported backup versions are rejected clearly.

The portable backup is a user-controlled file and follows Android's existing
behavior: the identity private key is present in the file when the user has Crew
memberships. It must be treated as sensitive. The extension's passphrase-encrypted
`pomo-recovery.v1` file remains the safer identity migration/recovery path, but it
is intentionally not presented as an Android-importable backup because Android's
backup reader does not consume that envelope.

## Import rules

History is a merge keyed by session `start`; an existing local row wins and a
missing row is added. Day totals are rebuilt from sessions and never subtracted.
Crew projection rows are restored cached-first. A different imported identity is
never silently written over an extension identity: active memberships reject the
import, and an identity replacement with no memberships requires an explicit UI
confirmation.

Both surfaces reject malformed or newer versions. The extension validates the
identity's derived public key before accepting Crew projection data. This keeps
phone export -> extension import and extension export -> phone import on the same
history, identity, membership, and projection semantics.
