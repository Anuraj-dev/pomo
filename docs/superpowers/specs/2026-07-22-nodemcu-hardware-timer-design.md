# NodeMCU Hardware Timer — Design

Status: approved (hybrid offline addendum)
Date: 2026-07-22
Updated: 2026-08-06 (hybrid offline mode)

## Goal

A desk device (ESP8266 NodeMCU, 16x2 I2C LCD, buzzer, flash button) that mirrors
and controls the Pomo timer over the LAN, and runs a full local Pomodoro when the
phone is unreachable. Start a session on the phone and the LCD shows it counting
down. Press the device button and the phone updates while synced. When a phase
completes the buzzer rings, so a silenced phone in another room still gets an
audible alarm. When the phone is off the LAN, the desk still times focus blocks
and later flushes history / may hand a live timer to the phone.

## Non-Goals

- No cloud, relay, or broker. The device and phone share a LAN.
- No Notion integration. The old standalone sketch is archived at
  `Anuraj-dev/pomodoro-timer-esp8266-notion` (private) and is not carried forward.
- No dual live clocks. While SYNCED the phone is the sole live clock; while
  OFFLINE the desk is. On reconnect, **least remaining wins**: adopt succeeds
  when the phone is stopped, same session, or both live and desk remaining is
  strictly less; otherwise HTTP 409 `timer_busy` (phone keeps its clock).
- No Android UI changes required for the hybrid path (API is additive).
- No new Pomo product features (presets, 90-minute mode). Work duration stays a
  phone setting (desk caches last known config for offline use).

> **Superseded (original 2026-07-22 non-goal):** “No standalone timer on the
> device. It never authors state.” Hybrid offline mode *does* run a local timer
> and appends completed sessions via `POST /api/sessions/import`, and may hand a
> live timer via `POST /api/timer/adopt`. Desktop clients remain non-authoring.

## Core Principle

The device is a **hybrid desk client**, alongside the home-screen widget and the
`desktop-client/` CLI. `PomodoroService` remains the sole write boundary on the
phone for live state and Room history, exactly as `docs/architecture.md`
requires. There is only ever one **live** clock at a time:

- **SYNC:** phone owns the clock; desk mirrors WebSocket + REST (as originally designed).
- **OFFLINE:** desk owns the clock; on reconnect it flushes history and may adopt.

```text
NodeMCU button ─┐
Widget ─────────┤
Notification ───┼──▶ PomodoroService ──▶ OfflineTimer ──▶ Room
Timer screen ───┤        (canonical while SYNC) │
Desktop CLI ────┘                               ▼
                                         broadcast: UI, notification,
                                         widget, WebSocket ──▶ NodeMCU LCD

OFFLINE path (desk):
  local TimerModel + buzzer + buttons
       │  completed sessions → LittleFS queue (≤32)
       └─ on reconnect: POST /api/sessions/import
                        POST /api/timer/adopt (desk live: phone stopped, or
                        both live and desk rem < phone rem; least remaining)
```

While SYNCED, the device sends commands over authenticated REST and renders
state from `/ws`. It does not optimistically mutate the model after commands.
While OFFLINE, local gestures mutate the desk engine only; reconnect is ordered
so the phone never shares live ownership with the desk.

## Part 1 — Android Changes

Three additive changes. No existing behaviour is refactored.

### 1.1 mDNS advertising

New file: `app/src/main/java/com/pomo/network/PomoServiceAdvertiser.kt`

Wraps `android.net.nsd.NsdManager`. Registers the phone API so the device can find
it by name instead of a hardcoded IP that breaks on every DHCP lease change.

```text
service type: _pomo._tcp
service name: Pomo
port:         prefs.phoneServerPort
```

Lifecycle is bound to the server, not the service: call `register()` immediately
after a successful `phoneServer.start()` and `unregister()` before every
`phoneServer.stop()`, inside `restartPhoneServerIfNeeded()`
(`PomodoroService.kt:607`) and `onDestroy` (`PomodoroService.kt:245`). This makes
advertising automatically inherit the existing enable toggle, wifi-only mode, and
port setting.

Requirements:

- Registration must be idempotent — re-registering while already registered must
  unregister first, or `NsdManager` leaks listeners.
- Registration failures are non-fatal and log-only, matching how `PhoneServer`
  already treats a failed port bind (`PhoneServer.kt:129-137`). The timer must
  never be taken down by an optional feature.
- `NsdManager.registerService` is asynchronous; the listener must be retained as
  a field so `unregisterService` can be called with the same instance.
- No new manifest permission. `INTERNET` and `ACCESS_NETWORK_STATE` are already
  declared and minSdk is 26.

### 1.2 `phase_complete` WebSocket event

The device cannot distinguish "the work phase finished" from "the user pressed
skip" using state snapshots alone — both surface as a phase change. Guessing
means the buzzer fires on a manual skip. So the phone states it explicitly.

New method on `PhoneServer` mirroring the existing `broadcastState()`
(`PhoneServer.kt:146`):

```kotlin
public suspend fun broadcastEvent(event: String, phase: String)
```

Frame shape:

```json
{ "type": "event", "event": "phase_complete", "phase": "work" }
```

`phase` uses the existing `TimerState` vocabulary: `work | short | long`.

Called from `PomodoroService.onTimerComplete()` (`PomodoroService.kt:334`), which
already captures `completedPhase`, directly alongside the existing
`cueEngine.playCompletion(it)` call. Dispatch the event **before** the state
broadcast. Dispatch order is not a delivery guarantee, though — the two frames
travel independently, so the device must treat the event (ring) and the state
snapshot (display) as independent inputs and tolerate either arrival order.

This is additive and backward-compatible: `desktop-client/` polls REST and
opens no WebSocket, so it never sees the new frame.

### 1.3 Documentation

- `docs/protocol.md` — add the event frame under the WebSocket section, and an
  mDNS discovery subsection under pairing. State plainly that clients must ignore
  unrecognised `type` values.
- `docs/architecture.md` — add the hardware device to the list of control
  surfaces routed through `PomodoroService`, and one line noting the phone
  advertises `_pomo._tcp` when the phone API is serving.

### 1.4 Android constraints

These are enforced by CI and will fail the build if violated:

- `-Xexplicit-api=strict` — every public declaration needs an explicit visibility
  modifier and explicit return type.
- `allWarningsAsErrors = true` — no unused imports, no deprecation warnings.
- `ktlintCheck` runs in CI before tests.

Per `CLAUDE.md`: do not run lint or tests locally. Branch, commit, open a PR.

## Part 2 — Firmware

### 2.1 Layout

Lives in the Pomo repo but is invisible to Gradle (`settings.gradle` includes
only `:app`) and to CI (Gradle-only workflow).

```text
firmware/
  README.md                  wiring, libraries, offline/SYNC, markers, flashing
  PomoLink/
    PomoLink.ino             setup() / loop(), wires the modules together
    secrets.h.example        template — copy to secrets.h and fill in
    PomoClient.h / .cpp      WiFi, discovery, WS, REST, import/adopt, modes
    TimerModel.h / .cpp      phone snapshot + local offline Pomodoro engine
    ConfigStore.h / .cpp     LittleFS durations, epoch basis, client_id seq
    SessionQueue.h / .cpp    bounded offline history queue for import
    Display.h / .cpp         16x2 LCD rendering + connection markers
    Buttons.h / .cpp         non-blocking multi-click and long-press detection
    Buzzer.h / .cpp          non-blocking melody sequencer
```

Arduino IDE requires the sketch filename to match its folder, hence
`PomoLink/PomoLink.ino`. Additional `.h`/`.cpp` files in the same folder are
compiled automatically by the IDE.

Add to `.gitignore`:

```text
firmware/PomoLink/secrets.h
```

### 2.2 Configuration

`secrets.h.example` defines and documents:

```c
#define WIFI_SSID        "your-wifi"
#define WIFI_PASS        "your-password"
#define POMO_TOKEN       "pairing token from Pomo Settings"
#define POMO_HOST_FALLBACK ""      // optional, e.g. "192.168.1.42"
#define POMO_PORT_FALLBACK 9876
```

The fallback host is used only if mDNS discovery fails, which happens on routers
that block multicast. Leaving it empty is valid.

### 2.3 Libraries

Pin these in `firmware/README.md`:

| Library | Source | Notes |
| --- | --- | --- |
| ESP8266 core | Boards Manager, `esp8266` by ESP8266 Community | 3.1.x+ |
| `ESP8266WiFi`, `ESP8266mDNS`, `ESP8266HTTPClient`, `Wire` | bundled with core | |
| `LiquidCrystal_I2C` | the fork exposing no-arg `lcd.begin()` | matches the archived sketch |
| `ArduinoJson` | bblanchon, **7.x** | use `JsonDocument`, not the v6 `DynamicJsonDocument` |
| `WebSocketsClient` | `arduinoWebSockets` by Links2004, 2.4+ | |

Plain HTTP only. No TLS — the device talks to a LAN address, consistent with
`desktop-client/`.

### 2.4 The blocking-delay problem

This is the single biggest risk in the port. The archived sketch calls `delay()`
throughout — 50 ms in button debounce, hundreds of ms per note in the melodies,
200 ms per step in the completion backlight blink. A WebSocket client must be
pumped continuously; a blocking melody will stall `webSocket.loop()` for seconds
and drop the connection mid-celebration.

Hard requirement: **no `delay()` anywhere in the main loop path.** Every module
exposes a non-blocking `tick()` driven by `millis()`, and `loop()` is:

```c
wifi.tick(); client.tick(); buttons.tick(); buzzer.tick(); display.tick();
```

`delay()` is permitted only during `setup()`, before the WebSocket exists.

The melodies keep their existing note tables and timings verbatim — Raja likes
how they sound — but play through a sequencer that advances one note per `tick()`
when `millis()` passes the current note's end. The completion backlight blink
becomes a millis-driven toggle with a step counter.

### 2.5 Connection state machine

```text
BOOT ─▶ WIFI ─▶ DISCOVERING ─▶ CONNECTING ─▶ SYNCED
  │       │         ▲     │            │            │
  │       │         │     │            │            ├─▶ OFFLINE (~) ──▶ progressive rediscover
  │       │         │     │            │            │                 + REST known-host probe
  │       │         │     │            │            └─▶ UNPAIRED (?) ──▶ (5 min) ──▶ DISCOVERING
  │       │         │     └─ boot probe (WiFi wait ~45s; DISCOVERING restarts ~45s) ─▶ OFFLINE
  └───────┴─────────┴──────── rediscover / unpaired cooldown ──────────┘
```

- `DISCOVERING` queries `MDNS.queryService("pomo", "tcp")` unless
  `POMO_HOST_FALLBACK` is set (configured host skips mDNS entirely) or a
  known host was just REST-proven while OFFLINE. Multi-responder: token-probe
  each candidate; select first HTTP 200. Boot probe is two sequential ~45 s
  windows: WiFi wait up to ~45 s, then on association the probe clock restarts
  for a fresh DISCOVERING ~45 s (worst case ~90 s to offline-usable). Hard-cuts
  only while still `DISCOVERING` / WiFi wait — not while `CONNECTING`.
- `CONNECTING` opens `/ws` and sends `{"type":"hello","token":"..."}` as the
  first frame. The boot probe watchdog does **not** hard-cut `CONNECTING`;
  handshake/hello wait is owned by the ~45 s socket-stale window (and
  enter-SYNC is not aborted mid-pipeline). First good WS `state` **or**
  healthy `GET /api/status` while CONNECTING runs the enter-SYNC pipeline
  (import → adopt → config cache). Immediate close after hello is probed via
  REST; HTTP 200 enters SYNC, HTTP 401 becomes `UNPAIRED` (`?`).
- Offline rediscover is progressive (~3 s → ~8 s → ~20 s → ~90 s baseline),
  not a fixed 90 s only. Unpaired cooldown is ~5 minutes. While OFFLINE with a
  known host, REST reachability ~every 5 s can force rediscover early.
- **Heartbeat (while SYNCED/CONNECTING):** poll `GET /api/status` every 30 s
  while SYNCED (~3 s while CONNECTING). While SYNCED, REST applies with lag
  projection + stale rejection (same as WS). While CONNECTING, healthy status
  completes enter-SYNC. While OFFLINE, status is reachability only (does not
  clobber the desk timer). Socket stale ~45 s or WS disconnect leaves SYNC for
  OFFLINE.

### 2.6 Time model

No NTP. The archived sketch's `getNTPTime()` is dropped entirely.

**SYNC path:** each state payload carries `remaining` in seconds. On receipt the
device records `rxMillis = millis()` alongside it. While `status == "running"`:

```text
displayed = remaining - (millis() - rxMillis) / 1000
```

Every subsequent push re-snaps the baseline. The 30 s heartbeat corrects drift.
When paused/stopped, `remaining` is shown as-is. `displayed` clamps at zero.
The desk does not advance the phone's phase — it waits for the phone.

**OFFLINE path:** the same millis extrapolation runs on desk-owned state. When
remaining hits zero the local engine completes the phase (buzzer + queue
enqueue + advance to next phase stopped). Phone `server_time` samples (and
cached config) give approximate wall-clock starts for import/adopt.

### 2.7 Controls

Single button on GPIO0 (flash), `INPUT_PULLUP`, active low. Debounce and click
counting are millis-based; the 400/600 ms multi-click windows from the archived
sketch carry over.

| Gesture | Request |
| --- | --- |
| Single click | `POST /api/toggle` — start / pause / resume |
| Double click | `POST /api/skip` — advance to next phase |
| Triple click | `POST /api/reset` — restart current phase |
| Hold 1 s | `POST /api/extend` with `{"seconds_delta": 300}` |

All requests carry `X-Pomo-Token`. Long press fires on release, not on threshold,
so it cannot be confused with a click.

**SYNCED:** gestures map to REST (`toggle` / `skip` / `reset` / `extend`). The
device does not optimistically update after a command; it waits for the phone
broadcast.

**OFFLINE / UNPAIRED:** gestures drive the local engine (same mapping). No REST
command queue — offline actions never replay against the phone later.

**Boot probe / no local owner yet:** gestures are ignored until OFFLINE or
SYNCED.

### 2.8 Display

16x2 I2C LCD at `0x27`, `Wire.begin(D2, D1)`.

Running:

```text
Focus       24:13
3/8 today
```

Idle:

```text
Pomo        25:00
Press to start
```

Paused:

```text
Paused      12:30
3/8 today
```

Row 0: phase label left-aligned (`Focus`, `Break`, `Long`, `Paused`, `Pomo`),
`MM:SS` right-aligned at columns 11-15. Row 0 shows the configured work duration
when idle.

Row 1: `completed/daily_goal today` — both fields are already in the state
payload. Column 15 of row 1 is the connection indicator:

| Char | Meaning |
| --- | --- |
| (space) | SYNCED — phone owns the live clock |
| `.` | connecting, discovering, boot probe, or enter-SYNC pipeline |
| `~` | OFFLINE — desk owns the live clock (was `!` in the original draft) |
| `?` | UNPAIRED — token rejected; local timer still usable — re-flash token |

Redraw only when the rendered text changes. A full `lcd.clear()` every second
causes visible flicker on I2C; write per-cell instead and only touch what moved.

### 2.9 Buzzer

Fires on **natural phase completion only** — never on skip/reset/pause, never on
button presses, never on errors.

- **SYNC:** phone WebSocket `phase_complete` event.
- **OFFLINE:** local engine rundown (same melodies).

- `phase == "work"` → the reward melody from the archived sketch
  (`Pomodoro_timer.ino:654`), plus the 3x backlight blink.
- `phase == "short"` or `"long"` → the gentler break-end melody
  (`Pomodoro_timer.ino:520-550`).

Both use the non-blocking sequencer of 2.4. If a new event arrives while a
melody is playing, the new melody replaces it rather than queuing.

### 2.10 Offline behaviour (hybrid — supersedes original draft)

Original draft required display-only stale countdown and silent buttons. Product
direction is **hybrid offline mode**:

| Topic | Behaviour |
| --- | --- |
| Ownership | SYNC → phone sole live clock. OFFLINE / UNPAIRED → desk sole live clock. Never both. |
| Boot | Two sequential ~45 s windows (marker `.`): WiFi wait up to ~45 s; after association, DISCOVERING restarts for another ~45 s (worst case ~90 s). Boot watchdog does not hard-cut CONNECTING (handshake uses ~45 s socket stale) or abort enter-SYNC mid-pipeline. Missing SSID / either timeout → offline-usable (`~`), not stuck on “Starting up”. |
| Rediscover | Progressive: ~3 s → ~8 s → ~20 s → ~90 s baseline while OFFLINE. REST reachability probe of known host ~every 5 s can skip mDNS. Marker `.` only while actively probing / CONNECTING. |
| Stale / leave SYNC | No socket contact for ~45 s, WS disconnect, or WiFi loss → local takeover from last remaining (`~`). |
| Local engine | Full Pomodoro: start/pause/resume, skip, reset, extend +300 s; natural complete buzzes and advances phase. Live timer snapshot `/pomo_timer.json` survives reboot. |
| History queue | Up to 32 completed sessions on LittleFS (`/pomo_sessions.json`); temp+rename + validation; drop oldest when full; real `start_time` when known. |
| Enter SYNC order | (1) first WS `state` **or** healthy `GET /api/status` while CONNECTING (2) `POST /api/sessions/import` (3) drop accepted ids (4) if desk live: adopt when phone stopped, or when both live and desk remaining < phone remaining (strict least-remaining); same session always; live adopt needs `start_time > 0` (5) on 409 (phone rem ≤ desk rem) or phone wins by remaining → snap to phone (6) cache `server_time` + `GET /api/config` (retry; periodic refresh while SYNCED). |
| Unpaired | Bad token → marker `?`, 5 min cooldown, **local controls still work**. |
| Sync trigger | Opening Pomo on the LAN is enough; no desk-side “sync now” gesture. |

Phone API additives (see `docs/protocol.md`): `server_time` on status/state,
`POST /api/sessions/import`, `POST /api/timer/adopt` (Room owns `completed`
after adopt).

## Addendum — Hybrid offline mode (2026-08-06)

This addendum freezes the product contract that overrides §2.10 of the original
approval and the “no standalone timer” non-goal:

1. **Phone optional at the desk.** Desk runs full Pomodoro offline; phone is
   not required for countdown, buzzer, or buttons.
2. **Ping cadence.** Progressive rediscover while offline (fast first retries,
   then ~90 s baseline) plus REST reachability on a known host (~5 s). Boot
   probe: WiFi wait ~45 s then fresh DISCOVERING ~45 s after association;
   CONNECTING uses ~45 s socket stale, not the boot-probe hard-cut.
3. **On connect.** Enter-SYNC from WS `state` **or** REST `/api/status` while
   CONNECTING. Flush offline history; optionally adopt a live desk timer under
   least remaining (phone stopped always; both live only if desk remaining is
   strictly less; same session always; live `start_time > 0`); otherwise 409 /
   snap to phone. Phone sets `completed` from Room after adopt.
4. **SYNC.** Phone is sole live clock; desk mirrors WS + REST with apply-before-
   cache lag projection and stale/out-of-order remaining rejection. Config
   retries and refreshes while SYNCED; `daily_goal` 0 accepted.
5. **Defaults.** Boot probe two × ~45 s (WiFi wait, then DISCOVERING after
   association), rediscover progressive then 90 s, stale 45 s, markers space /
   `~` / `.` / `?`, queue 32, timer snapshot `/pomo_timer.json`, durations
   25/5/15 (cached).
6. **mDNS.** Multi-responder token probe selects first HTTP 200; configured host
   fallback wins; phone `PomoServiceAdvertiser` retries async registration
   failures with bounded backoff.

## Addendum — Hybrid bugfix contract (code truth, 2026-08-06)

Short lock-in of behaviours implemented on `feat/nodemcu-hardware-timer` (see
firmware headers and `docs/protocol.md` / `firmware/README.md`):

| # | Behaviour |
| --- | --- |
| 1 | CONNECTING + healthy `GET /api/status` completes enter-SYNC (not WS-only). |
| 2 | Offline boot without WiFi becomes offline-usable (`~`), not stuck Starting up. |
| 3 | Progressive rediscover (fast then 90 s) + offline REST reachability probe. |
| 4 | SYNC countdown: apply-before-cache, lag projection, reject stale/out-of-order remaining inflation. |
| 5 | Config fetch retry + periodic refresh while SYNCED; `daily_goal` 0 accepted. |
| 6 | Offline timer snapshot survives reboot (`/pomo_timer.json`); real `start_time` for history. |
| 7 | SessionQueue crash-safer temp+rename + validation on load. |
| 8 | Adopt: Room is completed source of truth; live adopt requires `start_time > 0`; least-remaining. |
| 9 | mDNS: multi-responder token probe selects first 200; host fallback wins; phone advertiser retries async failures. |
| 10 | Markers: space SYNC, `~` OFFLINE, `.` probe, `?` unpaired. |

Firmware user docs: `firmware/README.md`. Client contract: `docs/protocol.md`.

## Verification

Android unit-testable:

- `PomoServiceAdvertiser` register/unregister idempotency against a fake
  `NsdManager` wrapper.
- `PhoneServer.broadcastEvent` frame shape, and that an event frame is
  structurally distinguishable from a state frame.

`desktop-client/` needs no regression test: it polls REST and opens no
WebSocket, so it cannot observe the new frame. Confirm with a grep for
`WebSocket` under `desktop-client/src/` before merging rather than assuming it.

Firmware is verified on real hardware — there is no emulator worth the effort:

1. Idle device shows `Pomo` and the configured work duration.
2. Start on phone → LCD switches to `Focus` and counts down within ~1 s.
3. Single click on device → phone UI pauses within ~1 s. Click again → resumes.
4. Double click → phone advances phase. Triple click → phone resets phase.
5. Hold 1 s → phone's remaining time jumps by 5 minutes.
6. Let a work phase run to zero → buzzer plays the reward melody, backlight
   blinks, phone records the session in Room.
7. Press skip mid-phase → phone advances, buzzer stays **silent**.
8. Force-stop the Pomo app → LCD shows `~` within ~45 s (or sooner on WS drop);
   local buttons still drive the desk timer offline.
9. Complete a work phase offline → buzzer rings; reopen Pomo on the LAN → desk
   reconnects, flushes import, history appears on the phone.
10. Start offline while phone is stopped → on reconnect desk adopts live timer
    onto the phone. Start offline while phone is already running with **more**
    remaining than the desk → desk adopts (least remaining). Start offline
    while phone remaining ≤ desk remaining → desk gets 409 and snaps to phone
    (no dual clocks).
11. Reboot the router so the phone gets a new IP → device rediscovers via mDNS
    with no reflash.
12. Rotate the pairing token in Pomo Settings → LCD shows `?`; local timer still
    works until `secrets.h` is reflashed.

## Risks

| Risk | Mitigation |
| --- | --- |
| Router blocks mDNS multicast | `POMO_HOST_FALLBACK` in `secrets.h` |
| Android doze suspends the Ktor server | `PomodoroService` is a foreground service; verify with the screen off for 30 min during test 6 |
| ESP8266 RAM exhaustion from JSON + WebSocket + LCD | ArduinoJson 7 with a bounded document; parse only the fields actually rendered; no full-history parsing on device |
| Blocking melody drops the WebSocket | Non-blocking sequencer (2.4) — the primary reason that requirement is non-negotiable |
| Phone IP changes mid-session | 30 s heartbeat detects the dead socket, state machine returns to `DISCOVERING` |

## Delivery

Raja flashes from a Windows machine: copy `firmware/PomoLink/` across, rename
`secrets.h.example` to `secrets.h`, fill in WiFi credentials and the pairing
token from Pomo Settings, select the NodeMCU 1.0 board, upload. `firmware/README.md`
carries these steps plus the wiring table and library versions.
