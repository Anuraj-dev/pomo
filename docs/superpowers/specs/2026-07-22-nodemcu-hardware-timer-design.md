# NodeMCU Hardware Timer — Design

Status: approved
Date: 2026-07-22

## Goal

A desk device (ESP8266 NodeMCU, 16x2 I2C LCD, buzzer, flash button) that mirrors
and controls the Pomo timer. Start a session on the phone and the LCD shows it
counting down. Press the device button and the phone updates. When a phase
completes the buzzer rings, so a silenced phone in another room still gets an
audible alarm.

## Non-Goals

- No cloud, relay, or broker. The device and phone share a LAN.
- No Notion integration. The old standalone sketch is archived at
  `Anuraj-dev/pomodoro-timer-esp8266-notion` (private) and is not carried forward.
- No standalone timer on the device. It never authors state.
- No Android UI changes.
- No new Pomo features (presets, 90-minute mode). Work duration stays a phone
  setting.

## Core Principle

The device is a **third thin client**, alongside the home-screen widget and the
`desktop-client/` CLI. `PomodoroService` remains the sole write boundary, exactly
as `docs/architecture.md` requires. Sync is a consequence of that, not a feature:
there is only ever one running clock, on the phone.

```text
NodeMCU button ─┐
Widget ─────────┤
Notification ───┼──▶ PomodoroService ──▶ OfflineTimer ──▶ Room
Timer screen ───┤        (canonical)          │
Desktop CLI ────┘                             ▼
                                       broadcast: UI, notification,
                                       widget, WebSocket ──▶ NodeMCU LCD
```

The device sends commands over the existing authenticated REST endpoints and
renders state from the existing `/ws` WebSocket. It caches the last known state
only for display. It never merges, writes, or reconciles history.

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
`cueEngine.playCompletion(it)` call. Emit the event **before** the state
broadcast, so the device rings while its display still shows the phase that just
ended.

This is additive and backward-compatible: `desktop-client/` switches on
`type == "state"` and ignores unknown frames.

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
  README.md                  wiring, libraries, board settings, flashing steps
  PomoLink/
    PomoLink.ino             setup() / loop(), wires the modules together
    secrets.h.example        template — copy to secrets.h and fill in
    PomoClient.h / .cpp      discovery, WebSocket, REST commands, JSON parsing
    TimerModel.h / .cpp      last known state + local countdown extrapolation
    Display.h / .cpp         16x2 LCD rendering
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
BOOT ─▶ WIFI_CONNECTING ─▶ DISCOVERING ─▶ WS_CONNECTING ─▶ SYNCED
                 ▲                              │            │
                 └────────── on WiFi loss ──────┴────────────┘
                            (backoff, then retry from DISCOVERING)
```

- `DISCOVERING` queries `MDNS.queryService("pomo", "tcp")`. On a hit, use the
  returned IP and port. On miss, fall back to `POMO_HOST_FALLBACK` if set,
  otherwise retry with backoff.
- `WS_CONNECTING` opens `/ws` and sends `{"type":"hello","token":"..."}` as the
  first frame. The phone closes the socket on a bad token — treat an immediate
  close after hello as `UNPAIRED` and surface it on the LCD rather than
  reconnect-looping silently.
- Reconnect uses exponential backoff capped at 30 s, so a phone that is off for
  hours does not hammer the network.
- **Heartbeat:** poll `GET /api/status` every 30 s regardless of WebSocket
  health. This corrects any clock drift, detects a half-open socket that
  `webSocket.loop()` still believes is alive, and re-seeds state after a missed
  broadcast. If neither a WebSocket frame nor a successful poll lands within
  45 s, drop to `DISCONNECTED`.

### 2.6 Time model

No NTP. The archived sketch's `getNTPTime()` is dropped entirely.

Each state payload carries `remaining` in seconds. On receipt the device records
`rxMillis = millis()` alongside it. While `status == "running"` the displayed
value is:

```text
displayed = remaining - (millis() - rxMillis) / 1000
```

Every subsequent push re-snaps the baseline, so error never accumulates. Between
pushes the device free-runs on its own crystal for at most one phase; at ±20 ppm
that is well under a second over 25 minutes, and the 30 s heartbeat corrects it
anyway. When `status` is `paused` or `stopped`, `remaining` is displayed as-is
with no extrapolation.

`displayed` clamps at zero. The device never advances the phase itself — it waits
for the phone to say so.

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

Gestures are **ignored** unless the state is `SYNCED`. The device never queues
commands to replay later — a command replayed minutes after the fact would
control a timer the user has since changed, which is exactly the kind of implicit
override this design rules out.

The device does not optimistically update its display after sending a command. It
waits for the resulting broadcast, so what the LCD shows is always something the
phone actually said.

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
| (space) | synced |
| `.` | connecting or discovering |
| `!` | phone unreachable |
| `?` | token rejected — re-flash with a fresh token |

Redraw only when the rendered text changes. A full `lcd.clear()` every second
causes visible flicker on I2C; write per-cell instead and only touch what moved.

### 2.9 Buzzer

Fires **only** on a `phase_complete` event. Never on inferred state transitions,
never on button presses, never on errors.

- `phase == "work"` → the reward melody from the archived sketch
  (`Pomodoro_timer.ino:654`), plus the 3x backlight blink.
- `phase == "short"` or `"long"` → the gentler break-end melody
  (`Pomodoro_timer.ino:520-550`).

Both converted to the non-blocking sequencer of 2.4. If a new event arrives while
a melody is playing, the new melody replaces it rather than queuing.

### 2.10 Offline behaviour

Confirmed requirement: the device syncs, it never overrides.

- Phone unreachable while a timer was running: keep counting the display down
  from the last known state and show `!`. Do not fire the buzzer at zero — the
  device does not know whether the phone actually completed the phase. Hold at
  `00:00` until the truth arrives.
- On reconnect, snap to whatever the phone reports, even if that contradicts the
  local display.
- Buttons do nothing while disconnected.
- No local session is ever recorded or uploaded.

## Verification

Android unit-testable:

- `PomoServiceAdvertiser` register/unregister idempotency against a fake
  `NsdManager` wrapper.
- `PhoneServer.broadcastEvent` frame shape.
- A regression test that `desktop-client/` state parsing ignores `type: event`.

Firmware is verified on real hardware — there is no emulator worth the effort:

1. Idle device shows `Pomo` and the configured work duration.
2. Start on phone → LCD switches to `Focus` and counts down within ~1 s.
3. Single click on device → phone UI pauses within ~1 s. Click again → resumes.
4. Double click → phone advances phase. Triple click → phone resets phase.
5. Hold 1 s → phone's remaining time jumps by 5 minutes.
6. Let a work phase run to zero → buzzer plays the reward melody, backlight
   blinks, phone records the session in Room.
7. Press skip mid-phase → phone advances, buzzer stays **silent**.
8. Force-stop the Pomo app → LCD shows `!` within 45 s, buttons stop working.
9. Reopen Pomo → device reconnects and snaps to the phone's state.
10. Reboot the router so the phone gets a new IP → device rediscovers via mDNS
    with no reflash.
11. Rotate the pairing token in Pomo Settings → LCD shows `?`.

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
