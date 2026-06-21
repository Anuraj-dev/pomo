# Crew v2 Implementation Plan

Crew v2 is one atomic product release implemented through independently tested
internal slices. It prioritizes cached-first performance, dense ranking UI, and
useful aggregate statistics without introducing accounts or a Pomo-owned backend.

## Current Constraints To Remove

- `currentBoard()` blocks on relay pulls before returning UI state.
- Relay pulls and publishes run sequentially; one slow relay delays the set.
- Each live event calls `currentBoard()` and therefore pulls every relay again.
- `LocalCrewRelayStore` persists only this phone's Snapshot in one
  SharedPreferences JSON blob, not the last assembled board.
- The screen uses `verticalScroll` plus `Column`, composing every member row.
- Ranking is duplicated between repository and Compose code, and equal scores
  receive distinct display ranks.
- Snapshot v1 duplicates member identity across RSA and secp256k1 keys.
- Incoming outer Nostr event signatures are not independently verified.
- Raw timer-control events trigger unnecessary publication.

## Slice 1: Freeze V2 Contracts

- Add versioned Join payload, shared URI, Snapshot, daily aggregate, Recovery
  envelope, ranking-window, activity, and freshness models.
- Snapshot contains Crew id, secp256k1 author identity, Display name, lifetime
  Focus minutes, current streak, last-focused timestamp, local date, numeric UTC
  offset, and no more than 30 dated daily aggregates.
- Join payload contains Crew id, immutable Crew name, relay set, and shared key.
- Reject unknown required versions, invalid lengths, malformed dates, unsafe
  names, duplicate daily dates, future-skewed timestamps, and oversized payloads.
- Lock codecs with golden vectors and malformed-input tests before transport or
  UI work consumes them.

## Slice 2: Replace Dual Identity And Secure Secrets

- Make the Nostr secp256k1 key the sole ranked Identity and event author.
- Verify event id, kind, Crew tag, author key, and Schnorr signature before
  decrypting Snapshot content.
- Remove RSA signing and verification from v2 paths.
- Wrap the Identity private key and Crew shared keys with a non-exportable Android
  Keystore AES key; migrate no plaintext secret into v2 storage.
- Keep cryptographic work on bounded background dispatchers and clear temporary
  secret byte arrays where practical.

## Slice 3: Add The Room Crew Projection

- Add a latest-Snapshot entity keyed by `(crewId, identityPublicKey)`, daily
  aggregate storage, per-relay freshness, local hidden-member state, membership
  metadata, and self-publish metadata.
- Use a transaction for latest-wins validation and aggregate replacement.
- Index active-Crew and freshness queries; keep canonical History tables isolated.
- Expose cached board flows immediately, without starting network work in the
  read path.
- Cover migration, latest-wins races, malformed rows, Crew isolation, hide/unhide,
  and atomic restore with Room tests.

## Slice 4: Rebuild Relay Synchronization

- Fan out pull and publish work concurrently with independent bounds and a
  3-second overall refresh budget.
- Merge each valid response into Room as it arrives; report relay coverage and
  first/last successful update separately.
- Decode a live event directly into the projection. Never re-pull all relays in
  response to an event.
- Scope live sockets to the visible Crew lifecycle and close them deterministically.
- Publish asynchronously after committed aggregate changes, identity changes,
  Crew create/join, or a screen-open durability check older than 24 hours.
- Remove publication from start, pause, reset, and skip paths that do not commit
  aggregate changes.

## Slice 5: Centralize Ranking And Statistics

- Compute Today, current local date plus previous 6 dates, current plus previous
  29 dates, and All-time outside Compose.
- Use competition ranking (`1, 1, 3`) for equal positive totals. Place zero-total
  members after ranked members with no numeric rank.
- Exclude hidden and inactive members from active ranking; retain inactive rows
  in a separate inspectable section.
- Derive Your Standing states, Crew sum/active/median, seven daily bars, 30-day
  member detail, active days, average per active day, best day, completed Work
  blocks, and self comparison from immutable projection state.
- Coalesce visible projection emissions to at most one per 100 ms during relay
  bursts while persisting each accepted event immediately.
- Remove all sorting, filtering, and rank reassignment from composables.

## Slice 6: Build The Leaderboard-First UI

- Render cached content immediately with compact freshness states: syncing,
  updated age, partial relay coverage, and offline age.
- Order the screen as Crew header, four-window control, Crew summary, Your
  Standing, searchable virtualized leaderboard, collapsed Inactive section.
- Use stable Identity keys in a `LazyColumn`; use seven cheap daily bars per row.
- Preserve canonical ranks during search and expose search only above 20 active
  members.
- Open member aggregate details in a bottom sheet; put hide/unhide there.
- Move creation, joining, switching, identity editing, sharing, recovery, and
  leaving to Manage Crew.
- Validate dark/light themes, WCAG AA, TalkBack descriptions, touch targets, and
  adaptive layouts at 200 percent font scale.

## Slice 7: Complete Join, Share, And Recovery

- Create immutable Crew names and versioned `pomo://crew/join/v2/<payload>` links.
- Support Android sharing, QR display, and secondary raw-code copy/paste.
- Show Crew name, relay domains, and shared-link/honor-system warning before Join.
- Implement Recovery envelope v1 with random salt, PBKDF2-HMAC-SHA256 at 600,000
  iterations, AES-256-GCM, and explicit algorithm parameters.
- Require biometric or device credential for export. Validate and decrypt fully
  before an atomic restore; offer current-Identity export before replacement.

## Slice 8: Archive V1 And Ship Atomically

- Detect existing v1 memberships and retain them as local read-only archives.
- Present one migration notice and require creating or joining v2 for active use.
- Never merge v1 and v2 events or ranks.
- Enable production v2 only after create, join, publish, pull, offline cache,
  recovery, and migration paths pass end-to-end tests.

## Performance And Release Gates

- Cached leaderboard visible within 100 ms of entering Crew.
- Ranking-window switch completes within one 16 ms frame for 500 members.
- First fake healthy-relay update is visible within 1 second.
- Refresh settles into complete, partial, or offline state within 3 seconds.
- Crew networking and crypto cause no timer-frame or service-command delay.
- Deterministic 500-member ranking benchmark passes.
- Android Macrobenchmark covers cached render and window switching.
- Fake-relay integration tests cover out-of-order responses, duplicates,
  invalid signatures, timeouts, partial success, reconnect, and cancellation.
- Public-relay timing is observed manually and never gates CI.

## Atomic Release Definition

Crew v2 is releasable only when all slices above work together. Internal commits
may land slice-by-slice, but no production build may archive v1 until a member can
create or join v2, recover an Identity, publish aggregate stats, open cached
rankings instantly, refresh incrementally, inspect all ranking windows, and use
the full management flow.
