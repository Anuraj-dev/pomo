# Crew leaderboard runs over open Nostr-style relays, not a backend we own

We want a friends leaderboard ([[Crew]]) but refuse to operate or pay for
backend infrastructure. Truly direct phone-to-phone is impossible across the
internet (phones have no public address and sleep), and a backend we run is a
non-goal. We chose to publish per-member [[Snapshot]]s as signed,
Crew-encrypted events to a set of public Nostr-style [[Relay]]s run by
strangers; every member's app pulls and ranks locally. "Decentralized" therefore
means "no central authority and no infra we own" — not "no servers anywhere."

## Considered Options

- **Our own backend (Firebase/Supabase/custom):** rejected — ongoing cost/ops,
  and it makes us the central authority we explicitly don't want to be.
- **LAN-only P2P (reuse Ktor + NSD):** rejected as the primary path — only works
  when everyone is on the same Wi-Fi; a leaderboard implies remote friends.
- **Open relays (chosen):** internet reach, no central authority, anonymous
  keypair identity, no accounts. Cost is relay flakiness and the engineering of
  encryption + publish/pull over an eventually-consistent transport.

## Consequences

- Identity is a per-device keypair ([[Identity key]]); reinstall = new identity
  and lost board history unless we later add key export. Shipping without export.
- Self-reported metrics are unverifiable and add-time has no cap — the board is
  honor-system by design.
- No admin: nobody can be kicked. Stale members are aged out by last-active, not
  removed. A member Identity may be hidden locally on one phone; this does not
  alter relay data or anybody else's Crew. A compromised join code requires a
  new Crew.
- Seven days without a completed Focus Work block marks a member stale. Thirty
  days moves them out of active ranking into an inspectable inactive projection;
  their latest valid aggregate remains stored. Snapshot publish time is tracked
  separately and never resets this focus-activity clock.
- Freshness is event-driven + tab-refresh; "focusing now" is really "last seen
  N minutes ago," never a live signal.

## Decision Note 0001-A: Snapshot Protocol Contract

Human sign-off: approved in-thread by Snehit on 2026-06-18 to unblock the Crew
implementation slices.

### Event Kind

Crew Snapshots use one app-specific parameterized replaceable Nostr event kind:

- `kind = 39050`
- `pubkey = Identity key public key`
- `tags` include `["d", crewId]`, so each `{kind, pubkey, crewId}` stores the
  latest Snapshot for one Identity in one Crew.
- `content` is the encrypted Snapshot envelope.

This matches the product model: every member publishes one latest Snapshot per
Crew, relays may discard older versions, and the app ranks locally after pull.

### Encryption And Signing

Snapshots are signed by the member's Identity key using the normal Nostr event
signature. The Identity key is the author identity; display name remains
self-asserted Snapshot content.

Snapshot content is encrypted with NIP-44 v2 semantics:

- The join code carries a Crew private key, not just an opaque symmetric secret.
- The Crew public key is derived from that private key and may be public.
- Publishers encrypt Snapshot JSON from their Identity private key to the Crew
  public key.
- Readers decrypt with the Crew private key and the event author's public key.
- Decryption failure, malformed plaintext, or event signature failure rejects the
  Snapshot.

Relays only see event metadata and ciphertext. Anyone holding the join code can
decrypt Crew Snapshots, which is the intended membership model.

### Default Relays

The bundled relay set is:

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.primal.net`

Publishing fans out to all configured relays. A publish is usable if at least
one relay accepts it. Pulling merges events from all reachable relays and keeps
the latest valid Snapshot per Identity key.

Join codes may override the relay list. When a join code omits relays, the app
uses the bundled defaults.

Snapshot v2 join codes also carry an immutable human-readable Crew name selected
at creation. The Crew id remains the protocol identity; clients use the stable
name for headers and switching and do not attempt decentralized mutable renames.

The canonical v2 share and QR representation is the versioned custom URI
`pomo://crew/join/v2/<payload>`. The decoder continues to accept raw join codes
for paste compatibility. Handling the URI opens a confirmation surface and does
not persist membership automatically.

### Client Implementation

Use a small hand-rolled Nostr client for this feature rather than adding a
general-purpose Kotlin Nostr SDK now.

Rationale:

- The first Crew slices need only a narrow subset: connect WebSocket, send
  `REQ`/`EVENT`/`CLOSE`, parse relay responses, build/sign events, and apply
  NIP-44 v2 Snapshot encryption.
- A narrow interface keeps relay transport as the thin edge while the join-code,
  Snapshot codec, and leaderboard aggregator stay JVM-testable.
- A broad SDK can be revisited if later Crew features need more NIPs, relay
  management, or compatibility behavior than this subset.

## Decision Note 0001-B: Snapshot Crypto Reconciliation

Supersedes the cryptographic specifics of 0001-A. Documents the scheme actually
shipped on `main` as of 2026-06-19. Tracking: issue #33.

0001-A specified NIP-44 v2 with an asymmetric Crew keypair derived from the join
code. The shipped implementation diverges, and this note makes the shipped
behavior the source of truth. We chose to document reality rather than rewrite
shipped crypto: the current scheme is confidential for the honor-system model,
and a NIP-44 migration would be breaking (it invalidates every already-published
[[Snapshot]]) and security-sensitive enough to deserve its own review.

### Snapshot Encryption (As Shipped)

- The join code `key` is a 256-bit random secret used as a **shared symmetric
  passphrase**, not a Crew private key. There is no derived Crew public key and
  no ECDH.
- Snapshot content is encrypted with **AES-256-GCM** (`AES/GCM/NoPadding`). The
  AES key is `SHA-256(key)` over the passphrase's UTF-8 bytes, with a fresh
  12-byte random nonce per Snapshot and a 128-bit authentication tag. The nonce
  and ciphertext+tag are stored base64url (unpadded) in the envelope.
- The membership property is unchanged from 0001-A: anyone holding the join code
  can decrypt every member's Snapshot. Relays still see only ciphertext and
  event metadata.

### Identity (As Shipped)

Two per-device keys operate at different layers:

- **Transport author:** a **secp256k1** key (`CrewNostrKeys`) signs the outer
  Nostr event (`kind 39050`) with a standard Schnorr signature, as Nostr
  requires.
- **Snapshot author / ranked identity:** an **RSA-2048 `SHA256withRSA`** key
  (`CrewIdentityKeys`) signs the inner Snapshot envelope, and its public key is
  the `identityPublicKey` the leaderboard de-dupes and ranks on. A reader rejects
  any envelope whose signature does not verify against the embedded
  `identityPublicKey`.

Both keys live in non-backed-up `pairing_prefs`; reinstall yields new identities,
as 0001-A already accepted.

### Consequences And Future Work

- This scheme provides confidentiality plus per-Snapshot integrity (via the RSA
  envelope signature), but not NIP-44's sender-authenticated ECDH. Stating that
  plainly here is the point of this note.
- The last successfully assembled leaderboard is a local read model. Crew renders
  that read model immediately, marks its freshness, and refreshes relays in the
  background; relay latency or failure must not block opening the screen.
- Relay pulls and publishes fan out concurrently with independent bounded
  timeouts. Pull results merge incrementally into the local read model. A live
  event is decoded and merged directly; it must not trigger a fresh pull from
  every relay. Network publication never blocks timer execution. Refresh has a
  3-second overall budget and exposes partial/offline state instead of extending
  that wait for a slow relay.
- Live relay subscriptions are screen-scoped to visible Crew UI. There is no
  periodic background pull or always-on Crew socket; Room provides startup data.
- Publication follows committed aggregate changes, display-identity changes, and
  Crew create/join. A visible Crew may republish unchanged self data when its
  last successful publish is older than 24 hours. Raw timer-control events are
  not publication triggers unless they commit an aggregate change.
- A Snapshot carries lifetime Focus minutes, current streak, and at most the
  latest 30 phone-local daily aggregates of Focus minutes and completed Work
  blocks. It does not carry individual Work block timestamps. Ranking windows
  and Crew trend statistics are derived locally from those aggregates.
- Snapshot v2 includes its phone-local date and numeric UTC offset at publication
  so readers can expire Today correctly. It does not publish a timezone id or
  name.
- Snapshot v2 does not claim a previous rank. Clients do not display rank-change
  arrows derived from incomplete local relay history; that requires a future
  explicit, reliable comparison baseline.
- Valid latest Snapshots are persisted in a Room-backed read model keyed by
  `(crewId, identityPublicKey)`. SharedPreferences is not the leaderboard cache;
  Room provides atomic latest-wins upserts, indexed per-Crew reads, and a reactive
  stream for incremental UI updates. This projection remains isolated from
  canonical private History.
- Snapshot v2 below supersedes the dual-identity portion of this shipped scheme.

## Decision Note 0001-C: Snapshot v2 Uses One Member Identity

Approved in-thread by Snehit on 2026-06-20. Supersedes the Identity section of
0001-B while retaining its shared-key AES-256-GCM encryption.

- The outer Nostr event's secp256k1 public key is both the transport author and
  the ranked Identity key. Snapshot v2 has no RSA identity or inner RSA
  signature.
- Readers independently verify the event id and Schnorr signature before
  decrypting or accepting its Snapshot. Relay delivery is not proof of validity.
- The parameterized replaceable event key remains `{kind, pubkey, crewId}`.
- This intentionally breaking migration is combined with the new aggregate
  Snapshot schema. Existing RSA identities and cached v1 rows are not migrated;
  members appear as their new secp256k1 identity after publishing v2.
- v1 and v2 events are never merged into one leaderboard. Existing v1
  memberships and cached data are archived locally as read-only reference behind
  a one-time migration notice. Active use requires creating or joining a v2 Crew.
- Reinstall creates a new identity unless the member restores a Recovery file.
- Snapshot v2 adds explicit backup and restore through a passphrase-encrypted
  recovery file containing the secp256k1 Identity and Crew memberships. The
  private Identity key never appears in a Join link or unencrypted QR. Without a
  recovery file, reinstall still creates a new Identity.
- Restore is singular and atomic. When a different local Identity exists, the UI
  offers to export it and requires destructive confirmation before replacing the
  Identity plus memberships and rebuilding the local Crew projection. Identities
  are never merged.
- Recovery envelope v1 is versioned and records its KDF and cipher parameters.
  It derives a 256-bit key from the passphrase using PBKDF2-HMAC-SHA256 with a
  fresh random salt and 600,000 iterations, then encrypts with AES-256-GCM using
  a fresh 12-byte nonce and 128-bit authentication tag. Import rejects malformed
  envelopes or authentication failure before changing local state.
- At rest, the secp256k1 private Identity key and Crew shared keys are encrypted
  with a non-exportable Android Keystore-backed AES wrapping key rather than
  stored as plaintext SharedPreferences values. Keystore loss requires Recovery
  restore. Normal Room projections contain no private key material.
- Recovery export requires a successful biometric or device-credential prompt.
  Normal Snapshot signing does not require interactive authentication because it
  runs from timer/service publication paths.
