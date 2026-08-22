# Packaged sync validation runbook

This is the issue 120 validation procedure. CI builds the artifacts. A person
installs them, runs each row, and writes `PASS_PHYSICAL`, `FAIL_PHYSICAL`, or
`BLOCKED` with versioned evidence into
`sync-protocol/activation/physical-matrix.json`.

Production activation stays off until every required row is `PASS_PHYSICAL`.
CI rejects `productionActivation=true` otherwise.

## What this runbook is not

WorkManager ordinary drain is packaged on test artifacts. It still has no LAN,
WebDAV, Nostr, or TURN route, so Retry now walks the outbox and stays
local-only. Rows that need a live replica session start as `BLOCKED` with a
reason. Do not rewrite a blocked row into a pass by weakening the protocol.

## Artifacts

Download the PR or `main` workflow artifacts named:

- `android-sync-artifacts`
- `chrome-sync-artifacts`
- `sync-host-evidence`
- `sync-validation-bundle` (checksums, matrix copy, this runbook)

Use the `devDebug` APK (`POMO_SYNC_TEST_ARTIFACT=true`) and the Chrome zip built
with `POMO_SYNC_TEST_ARTIFACT=true`. The `prodDebug` APK is the dormant
production control: same protocol, test surfaces off, activation off. Do not
install it for the test rows.

Hash all three files from the same bundle into `artifactVersions`:

- `androidDevDebugSha256` for the test APK you install
- `androidProdDebugSha256` for the unused prodDebug control APK
- `chromeTestZipSha256` for the Chrome zip you load unpacked

Each hash is 64 hexadecimal characters. Record the git commit SHA in `commit`.
Every `PASS_PHYSICAL` or `FAIL_PHYSICAL` evidence line must include that commit
SHA so the row names an immutable revision.

## Install order

1. Confirm `sync-protocol/fixtures/system-generation.json` still has
   `"productionActivation": false`.
2. Confirm `bun --cwd extension run sync:verify-activation-gate` exits 0.
3. Install Android test APK before Chrome, so the phone is the history authority
   during later rows.

```bash
./scripts/install-sync-validation.sh android-sync-artifacts/app-dev-debug.apk
adb shell am start -n com.pomo/.MainActivity
```

4. Load the Chrome test package as an unpacked extension from the unzipped
   `pomo-sync-test-extension.zip` (Chrome → Extensions → Developer mode →
   Load unpacked). Do not use the store build.
5. Keep NodeMCU, firmware, and the desktop client on their current LAN-API
   behavior. They are not Full Replicas.

Post-merge check of the same commit:

```bash
gh run download --name sync-validation-bundle
sha256sum -c validation-bundle/SHA256SUMS
./scripts/install-sync-validation.sh validation-bundle/app-dev-debug.apk
adb shell dumpsys package com.pomo | grep -E 'versionName|signatures'
bun --cwd extension run sync:verify-package --test
bun --cwd extension run sync:verify-activation-gate
```

## How to score a row

Every row must use exactly one status:

- `PASS_PHYSICAL` — you ran the procedure on real devices or providers, kept
  the evidence file or gist, and the expected replica behavior happened.
- `FAIL_PHYSICAL` — you ran it and it failed. Keep the logs. Open a repair PR.
  Do not delete the evidence row. Do not skip a protocol check to make it pass.
- `BLOCKED` — you could not run it. Write why. Activation stays off.

Evidence is a repo path, gist URL, or issue comment URL plus the 40-character
commit SHA. Artifact hashes already live on the matrix. Empty `evidence` is not
a pass.

## Rows

### Android to Android

Two phones, both on the test APK, same Member after admission.

Expect: an authenticated History or preference Operation authored on phone A
appears on phone B without a database-snapshot copy. Absence on B is replica
failure, not deletion.

### Android to Chrome

Phone test APK and Chrome test package, same Member.

Expect: the same Operation is admitted by both kernels. Room remains canonical
history. IndexedDB is a replica journal.

### Chrome to Chrome

Two Chrome profiles, both on the test package.

Expect: WebRTC or Mailbox delivery, kernel ingest on both sides, no snapshot
sync.

### LAN

Same Member, devices on one layer-2 network, internet optional-off.

Expect: LAN is used when it is reachable. Retry now requests a bounded drain.

### Direct internet

Devices not on the same LAN. No TURN.

Expect: rendezvous delivers catch-up objects. Provider faults do not delete.

### TURN

WebRTC path that needs a TURN relay.

Expect: connectivity works; TURN is not domain authority.

### Multiple WebDAV providers

At least two Mailboxes.

Expect: each Mailbox reports protection independently. One provider rollback,
quota, credential, or CORS failure degrades only that route.

### Offline duration

Author work while the peer is gone long enough for a process restart. Then
reconnect.

Expect: local commit happened before UI success. Catch-up is exact, not last
write wins.

### Lifecycle loss

Force-stop Android, restart Chrome's service worker, reboot one device.

Expect: journal retained. No inferred tombstones. Replica resumes or reports
failure.

### Recovery

Produce a Recovery file from one Full device. Wipe or replace the other. Restore
forward.

Expect: Safety checkpoint plus compensating Operations. Active phases, revoked
keys, Content epochs, and Recovery authority are not rewound.

### Migration

Unmigrated Room and IndexedDB datasets, side by side.

Expect: inventory, Import proposals, zero unexplained omissions, parked timer,
then stop. Do not cut over while this runbook's matrix still has activation
off.

### Conflict

Two authentic concurrent timer or history branches.

Expect: both retained. Settlement cites every head. No automatic winner.

### Performance

Packaged phone and Chrome, not the Bun host gate.

Expect: record authoring p95, backlog drain, and timer-frame blocking on the
devices you installed. Host JSON from `sync-host-evidence` is not this row.

## Failures

A `FAIL_PHYSICAL` row opens a focused repair PR against the failing host or
protocol bug. The matrix row stays. Protocol checks in CI stay. Do not merge
activation from a branch that deletes evidence or sets a failed row to
`BLOCKED` to sneak the flag through.

## Activation

After every required row is `PASS_PHYSICAL`:

```bash
bun --cwd extension run sync:apply-production-activation
```

That command only flips `sync-protocol/fixtures/system-generation.json`. Gradle
and the Chrome production package read the fixture. Open that isolated change
as its own PR. CI will fail it if the matrix is incomplete.
