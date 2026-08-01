# The extension's identity keyring is wrapped by a key in chrome.storage.local

On the phone, the crew [[Identity key]] private material is wrapped by an
Android Keystore-backed key: hardware/OS-protected, survives restarts, and if
lost, the [[Recovery file]] is the only way back. Chrome has no equivalent for
extension code — there is no Keystore-like secure element an extension service
worker can use, and the only truly volatile storage (`chrome.storage.session`)
is wiped on every browser restart.

Options: (a) leave the private key in plain `chrome.storage.local` — honest but
raw key material at rest with zero wrapping; (b) wrap with a key kept in session
storage — Keystore-like loss semantics, but the identity dies on every browser
restart and Crew breaks until the user restores from the Recovery file; (c) wrap
with a random AES-256 key kept in `chrome.storage.local` — defense-in-depth:
key material is never stored in plaintext, the wrapping key is scoped to this
extension's storage partition, and identity survives restarts without ceremony.

We chose (c): encryption at rest plus continuity. The Recovery file still
exists (passphrase → PBKDF2 → AES-GCM) for device migration and for the
Keystore-loss scenario, and restoring over a different identity remains the
explicit destructive replacement the product specifies.

## Considered Options

- **Plaintext private key in storage.local:** rejected — raw identity material
  at rest, no defense at all.
- **Wrapping key in storage.session (Keystore emulation):** rejected — restart
  wipes the identity, turning a normal browser restart into a recovery ritual.
- **Wrapping key in storage.local (chosen):** encrypted at rest, survives
  restarts, recoverable if this extension's storage is ever lost.

## Consequences

- The wrap is obfuscation-plus-scoping, not hardware security — documented, not
  advertised. Crew remains honor-system and privacy-preserving by protocol, and
  the compromise risk is the local machine itself.
- The extension's CryptoLayer mirrors the phone's API shape (wrap/unwrap, export,
  import-replace), so behavior parity holds even though the trust anchor differs.
