# Pomo Chrome Extension

MV3 port of Pomo's pomodoro timer, history, and stats. The phone owns Crew and
is the live clock once Chrome speaks the LAN API (next change). Until then the
extension is a local instrument with its own engine.

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
- `pomo-backup` v1 still moves history between phone and Chrome. Chrome writes
  an empty Crew object and ignores Crew on import (ADR-0011 as narrowed by
  ADR-0012).
- Known platform constraint: Chrome toolbar badges fit roughly 4 characters,
  so the badge shows `M:SS` under 10 minutes and `Nm` above.

## CI

Extension checks (typecheck, tests, build) run in GitHub Actions alongside the
Android CI on every PR.
