# Pomo Chrome Extension

MV3 port of Pomo's pomodoro timer, history, and stats. Pair it with the phone
from Settings using the `{url, token}` payload. While the phone is on the LAN,
Chrome follows the phone clock. When the phone is gone, the local engine runs
and completed blocks flush back on reconnect (import + least-remaining adopt).
Crew stays on the phone.

## Build

Requires [Bun](https://bun.sh).

```bash
bun install
bun run build   # bundles sw.js, surface scripts, html/css, icons into dist/
```

## Load unpacked

1. `bun run build`
2. chrome://extensions → Developer mode → Load unpacked → select `dist/`
3. New Tab shows the timer. The side panel mirrors the instrument and links to
   History. The Popup is a compact timer control surface.

## Test

```bash
bun test
bunx tsc --noEmit
```

Per repo convention, extension tests, typecheck, and build run in CI rather than
locally.

## Architecture notes

- Service worker owns the single-writer `TimerEngine` (ADR-0008), persists a
  snapshot under `storage.local` key `pomo:engine`, ticks a 0.5 min alarm, and
  bridges state to surfaces over `storage.session` (`pomo:state`).
- Time derives from the stored `endAt` (ADR-0007): running remaining is
  `startTime + duration - now`, so Chrome being closed just completes the block
  as-if-finished on the next wake.
- Pairing, REST, and `/ws` live in `src/link/`. The service worker owns the
  client; surfaces only paste the payload and show Phone / Local / Linking.
- On reconnect (and when a phase completes on the phone) Chrome pulls
  `GET /api/history` and inserts missing sessions by `start`. Phone dates win;
  existing Chrome rows are left alone.
- `pomo-backup` v1 still moves history between phone and Chrome as a file.
  Chrome writes an empty Crew object and ignores Crew on import (ADR-0011 as
  narrowed by ADR-0012).
- Known platform constraint: Chrome toolbar badges fit roughly 4 characters,
  so the badge shows `M:SS` under 10 minutes and `Nm` above.

## CI

Extension checks (typecheck, tests, build) run in GitHub Actions alongside the
Android CI on every PR.
