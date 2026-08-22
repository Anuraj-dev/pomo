# Sync PR merge order

Issue 120 asks for an explicit stack order so activation is a later, mechanical
change. Do not merge activation in the same commit as protocol or host work.

## Already on main

1. PR 123 (`feat/sync-complete-system`) — dormant POMO-SUITE-1 packaging.
2. Release bump `2.14.0`.

## This stack

3. PR 124 (`fix/sync-review-gaps`) — review-gap fixes, domain allowlist
   (kinds 2-6), validation runbook, physical matrix, activation gate, signed
   CI test artifacts. `productionActivation` remains `false`.
4. Human: download `sync-validation-bundle` from the merged workflow on `main`,
   install, execute `docs/sync-validation-runbook.md`, write evidence into
   `sync-protocol/activation/physical-matrix.json`.

## Live host loop

PR 125 carries ordinary drain, Replica LAN, WebDAV Mailbox routes, Nostr
rendezvous catch-up, optional TURN ICE config, and content-epoch provider
wrapping on the same branch.
Next independently reviewable slices, in this order:

1. Replace live `OfflineTimer` / `TimerEngine` with the kernel-backed timer
   after hosts have physical evidence.
2. Collect physical matrix evidence, then the isolated activation PR.

Do not open the activation PR while any required row is `BLOCKED`.

## After evidence

5. Isolated activation PR, produced by
   `bun --cwd extension run sync:apply-production-activation`.
   It must contain the fixture flip and the completed matrix. No host or
   protocol edits.
6. If any required row is `FAIL_PHYSICAL`, ship a repair PR first. Leave the
   failed evidence in place.
7. If any required row is `BLOCKED`, do not open the activation PR.

Parent issue 101 stays open until activation merges and the owner accepts the
physical evidence.

## Post-merge commands

On the commit that merged step 3:

```bash
gh run list --branch main --workflow CI --limit 1
gh run download <id> --name sync-validation-bundle
sha256sum -c validation-bundle/SHA256SUMS
./scripts/install-sync-validation.sh validation-bundle/app-dev-debug.apk
bun --cwd extension run sync:verify-activation-gate
```

On the activation PR:

```bash
bun --cwd extension run sync:verify-activation-gate
git diff --stat
```

The diff should be `system-generation.json` plus `physical-matrix.json`.
Anything else is not the isolated activation change.
