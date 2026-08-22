# Dormant peer synchronization system

Pomo packages the complete peer-sync generation as a dormant system. Android
`devDebug` and the CI Chrome test package expose its test surfaces; normal
production artifacts keep `productionActivation=false`. There is no migration
cutover, dual-write period, or automatic activation in this stage.

Test artifacts run an ordinary drain host. Android schedules it with WorkManager.
Chrome runs it from the service worker when Retry now is pressed or a drain
request is stored. The host walks the durable outbox, offers at most 256
envelopes, and clears an obligation only after a signed durable ack is
persisted. No LAN, WebDAV, Nostr, or TURN route is wired yet, so a drain stays
local-only until those adapters exist.

## Authority and safety boundary

- Android Room remains canonical history. IndexedDB is the Chrome Full Replica
  journal, not a database-snapshot transport. Desktop and NodeMCU behavior is
  unchanged and neither becomes a Full Replica.
- Every synchronized change is an authenticated Operation admitted by
  `OperationKernel`. Kind 1 is the shared-preference tracer. Kinds 2-6 are the
  dormant domain allowlist: History, Tag, Profile, Crew, Timer. Unknown kinds are
  retained and forwarded without becoming preference projection. Absence, empty
  storage, corruption, an unreadable replica, or a missing provider object is a
  Replica failure, never a deletion. Only an explicit authenticated tombstone can
  delete shared meaning.
- There is no fallback cryptography, inferred conflict winner, or snapshot
  synchronization path. Unknown authenticated facts are retained and forwarded;
  unsupported current authority blocks authoring.
- `pomo-backup` v1 is a sensitivity-warned Legacy-import format only. It cannot
  grant Recovery authority or activate synchronization.

## Compatibility envelope

POMO-SUITE-1 generation 1 declares Operation schema 1, Checkpoint format 1,
Recovery format 1, and Compatibility-profile schema 1. A Full Replica is
`DeviceReady` only when the complete authenticated authoring baseline is
present. New generation activation is reader-first, names devices that must be
limited or revoked, and requires confirmation by another Full device or current
Recovery authority. Dormancy is never a compatibility decision.

The exact Android/Chrome envelope lives in
`sync-protocol/fixtures/system-generation.json`. Both runtime suites consume that
same file in CI.

## Migration and Recovery prerequisites

Migration is side-by-side and resumable. Before authority changes it requires a
Recovery artifact and anchor, a caught-up trusted baseline, explicit selection
when Member or Crew identities differ, a Parked legacy timer, matching
projection roots and domain invariants, and zero unexplained inventory
omissions. Success atomically activates the journal, seals an encrypted
read-only Legacy archive, and permanently retires dual-write. Failure leaves the
legacy instrument intact.

Recovery files contain protected current Recovery authority plus bounded
frontier/capability/Mailbox locators, not user data. Data archives contain
verified encrypted manifests, packs, Checkpoints, and blobs but grant no
authority without valid Recovery credentials. Restore is forward-only: it
creates a Safety checkpoint and appends selected compensating Operations.
Active phases, revoked keys, Content epochs, and Recovery authority cannot be
rewound.

## Evidence classification

| Class | CI artifact | What it proves | What it does not prove |
|---|---|---|---|
| CI conformance | Android and Bun test reports | Shared corpus, crash boundaries, parser fuzz, domain invariants | Provider or device behavior |
| Host benchmark | `sync-host-evidence` | Reference-host latency, throughput, batch, memory-ceiling, and blocking budgets | Packaged browser/phone timing |
| Packaged-runtime structural | `android-sync-artifacts`, `chrome-sync-artifacts` | Both modes package, MV3 constraints, dormant flags, no remote executable dependency | Runtime timing or connectivity |
| Provider | `physical-matrix.json` provider rows | Versioned PASS_PHYSICAL / FAIL_PHYSICAL / BLOCKED after the runbook | CI does not log into WebDAV, Nostr, or TURN |
| Physical | `physical-matrix.json` device rows | Versioned PASS_PHYSICAL / FAIL_PHYSICAL / BLOCKED after the runbook | CI does not prove phone, browser, radio, or network behavior |

The matrix file is `sync-protocol/activation/physical-matrix.json`. The procedure
is `docs/sync-validation-runbook.md`. Merge order is `docs/sync-merge-order.md`.
`bun --cwd extension run sync:verify-activation-gate` fails the build if
`productionActivation` is true while any required row is not `PASS_PHYSICAL`.

The diagnostics export is explicit, local, cancellable, streamed from a bounded
evidence source, and capped at 10 MiB. It aliases Device and Operation references
per export and rejects domain plaintext, keys, capabilities, credentials, and
Recovery material. Pomo has no mandatory telemetry backend and never uploads a
diagnostic export implicitly.

## Release note

This release candidate packages dormant peer synchronization, Data History,
Recovery, compatibility, migration staging, local diagnostic export, and the
issue 120 validation bundle on Android and Chrome. Existing unmigrated timer
and history behavior remains the active production path. Production migration
and activation stay off until the physical matrix is all `PASS_PHYSICAL`.
