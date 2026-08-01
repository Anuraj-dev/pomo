# Pomo Chrome Extension

Feature-complete MV3 port of Pomo's pomodoro timer plus the decentralized Crew
leaderboard. The phone remains the source of truth; the extension is a separate
instrument with its own data.

## Build

Requires [Bun](https://bun.sh).

```bash
bun install
bun run build   # bundles sw.js, surface scripts, html/css, icons into dist/
```

## Load unpacked

1. `bun run build`
2. chrome://extensions → Developer mode → Load unpacked → select `dist/`
3. New Tab shows the timer (flagship instrument). The popup and side panel
   mirror it; the Crew page is reachable via the "Crew" button in the popup or
   new tab.

## Test

```bash
bun test          # unit + integration (fake relays, fake-indexeddb)
bunx tsc --noEmit # typecheck
```

Per repo convention, linting and formatting run only in CI.

## Architecture notes

- Service worker owns the single-writer `TimerEngine` (ADR-0008), persists a
  snapshot under `storage.local` key `pomo:engine`, ticks a 0.5 min alarm, and
  bridges state to surfaces over `storage.session` (`pomo:state`).
- Time derives from the stored `endAt` (ADR-0007): running remaining is
  `startTime + duration - now`, so Chrome being closed just completes the block
  as-if-finished on the next wake.
- Crew sync runs from the service worker on a throttled alarm cycle: burst-fetch
  snapshots from relays, verify the Nostr event and decrypt the envelope,
  latest-wins into IndexedDB, then publish the member's own snapshot (built from
  local history) and store it locally so the member always ranks themselves.
- Identity: the Nostr secp256k1 private key is wrapped with a random AES-256
  wrapping key kept in `storage.local` (`pomo:keyring`); the recovery file uses
  the phone's `pomo-recovery.v1.` envelope (PBKDF2-HMAC-SHA256 at 600k
  iterations, AES-256-GCM), so a passphrase export on the extension restores on
  the phone and vice versa.
- Zero host permissions: Nostr relay traffic is plain WebSockets.
