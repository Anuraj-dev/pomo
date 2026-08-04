# Pomo Chrome Extension

Feature-complete MV3 port of Pomo's pomodoro timer, history, stats, and
decentralized Crew leaderboard. The phone and extension are separate local
surfaces backed by the same user-owned portable backup contract.

## Build

Requires [Bun](https://bun.sh).

```bash
bun install
bun run build   # bundles sw.js, surface scripts, html/css, icons into dist/
```

Plain Bun build is used intentionally — no Vite/CRXJS, deviating from the
original "Bun + Vite + CRXJS" plan.

## Load unpacked

1. `bun run build`
2. chrome://extensions → Developer mode → Load unpacked → select `dist/`
3. New Tab shows the timer (flagship instrument) when enabled. The side panel
   mirrors the instrument and links to History, Stats, and Crew. The Popup is a
   compact timer control surface; Crew lives in its full page.

## Test

```bash
bun test          # unit + integration (fake relays, fake-indexeddb)
bunx tsc --noEmit # typecheck
```

Per repo convention, all extension tests, typecheck, linting, formatting, and
build validation run in CI rather than locally.

## Architecture notes

- Service worker owns the single-writer `TimerEngine` (ADR-0008), persists a
  snapshot under `storage.local` key `pomo:engine`, ticks a 0.5 min alarm, and
  bridges state to surfaces over `storage.session` (`pomo:state`).
- Time derives from the stored `endAt` (ADR-0007): running remaining is
  `startTime + duration - now`, so Chrome being closed just completes the block
  as-if-finished on the next wake.
- Crew refresh is explicit when the Crew page opens or Refresh is pressed. Own
  snapshots publish after durable focus-aggregate, display-identity, create,
  join, or restore changes; unchanged data is republished only after 24 hours.
  Timer completion never waits on relay work.
- Identity: the Nostr secp256k1 private key is wrapped with a random AES-256
  wrapping key kept in `storage.local` (`pomo:keyring`); the passphrase recovery
  file is extension-specific. A corrupted keyring never mints a replacement
  identity; the worker stays available to restore that recovery file.
- Portable backup: `pomo-backup` v1 is the Android Room backup shape. Exporting
  or importing it from either surface carries history, Crew memberships,
  identity, and cached projections. It is a sensitive user-owned JSON file when
  Crew memberships are present; export it only to trusted storage.
- Zero host permissions: Nostr relay traffic is plain WebSockets.
- Known platform constraint: Chrome toolbar badges fit roughly 4 characters,
  so the badge shows `M:SS` under 10 minutes and `Nm` above — the plan's
  `M:SS`-always badge is not physically possible.

## CI

Extension checks (typecheck, tests, build) run in GitHub Actions alongside the
Android CI on every PR.
