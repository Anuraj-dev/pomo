# PomoLink — NodeMCU desk device

An ESP8266 NodeMCU that mirrors and controls the Pomo timer over your LAN, and
runs a full local Pomodoro when the phone is unreachable.

- **SYNCED (space marker):** the phone is the sole live clock. The desk displays
  WebSocket state, sends REST commands, and buzzes on phone `phase_complete`
  events.
- **OFFLINE (`~`) / UNPAIRED (`?`):** the desk owns countdown, buzzer, and
  buttons. Completed sessions are queued for flush on reconnect (history import
  + optional live-timer adopt). There is never dual live ownership.

**You do not need a special sync gesture.** Opening the Pomo app on the same
Wi‑Fi (so the phone API and mDNS advertisement are up) is enough: the desk
probes every ~90 s while offline, reconnects, flushes history, and may adopt a
live timer. Pairing token must already be in `secrets.h`.

See `docs/protocol.md` for the API it speaks and `docs/architecture.md` for the
hybrid client contract. Design background:
`docs/superpowers/specs/2026-07-22-nodemcu-hardware-timer-design.md` (including
the hybrid offline addendum).

## Hardware

| Component | NodeMCU pin |
| --- | --- |
| 16x2 I2C LCD, SDA | D2 |
| 16x2 I2C LCD, SCL | D1 |
| 16x2 I2C LCD, VCC / GND | VIN (5V) / GND |
| Passive buzzer, + | D5 |
| Passive buzzer, - | GND |
| Button | GPIO0 (the onboard FLASH button — nothing to wire) |

**5V I2C warning:** the ESP8266's GPIOs are 3.3V-only, and a PCF8574 backpack
powered from VIN pulls SDA/SCL up to 5V through its onboard pull-up resistors.
Most boards tolerate this in practice, but the safe wiring is to power the
backpack from 3V3 if the display is readable there, or to keep 5V power and put
a 3.3V/5V I2C level shifter between the backpack and D1/D2 (or re-pull the bus
to 3.3V).

The LCD is addressed at `0x27`. If yours is at `0x3F`, change `kLcdAddress` in
`Display.cpp`.

## Libraries

Install through the Arduino IDE Library Manager unless noted.

| Library | Version | Notes |
| --- | --- | --- |
| esp8266 boards | 3.1.x or newer | Boards Manager URL: `https://arduino.esp8266.com/stable/package_esp8266com_index.json` |
| ArduinoJson (bblanchon) | 7.x | v6 will not compile — this code uses `JsonDocument` |
| arduinoWebSockets (Links2004) | 2.4.0 or newer | |
| LiquidCrystal I2C (Frank de Brabander) | 1.1.2 | The Library Manager default. See the warning below — a same-named fork will not compile |

`ESP8266WiFi`, `ESP8266mDNS`, `ESP8266HTTPClient`, `LittleFS`, and `Wire` ship
with the board package.

**Two different libraries are called "LiquidCrystal I2C", and only one works.**
Install Frank de Brabander's, the one the Library Manager lists first — it is the
one with a no-argument `begin()`, which `Display.cpp` calls. John Rickman's
same-named fork replaces that with `init()` plus `begin(cols, rows, charsize)`,
so `Display.cpp` will not compile against it.

If you see `no matching function for call to 'LiquidCrystal_I2C::begin()'`, you
have the fork installed. Remove it and install de Brabander's from the Library
Manager. (Do not "fix" this by changing `begin()` to `init()` — that just breaks
it against the intended library instead.)

## Board settings

- Board: **NodeMCU 1.0 (ESP-12E Module)**
- CPU Frequency: 80 MHz
- Flash Size: 4MB (FS:2MB OTA:~1019KB)
- Upload Speed: 115200

## Flashing

1. Copy the whole `PomoLink/` folder to the machine with the Arduino IDE.
2. Rename `secrets.h.example` to `secrets.h`.
3. Fill in your WiFi credentials and the pairing token from Pomo's Settings screen.
4. Open `PomoLink.ino`, select the board above, and upload.

Open Serial Monitor at 115200 baud to watch discovery, mode transitions, flush,
and adopt results (`[PomoClient] mode …`, `flush accepted=…`, `adopt result=…`).

## Offline / SYNC behaviour

| Timing | Default |
| --- | --- |
| Boot probe for phone after WiFi (DISCOVERING only) | ~45 s |
| CONNECTING handshake / hello wait | ~45 s socket-stale window (boot watchdog does not hard-cut CONNECTING or abort enter-SYNC) |
| Rediscover while OFFLINE | every 90 s |
| SYNCED socket stale / WS loss → OFFLINE | 45 s stale (WS drop leaves SYNC immediately) |
| Unpaired token-reject cooldown | 5 min, then rediscover |
| Local durations (work / short / long) | 25 / 5 / 15 min (cached from phone) |
| Long break after N completed work blocks | 4 |
| Daily goal (display) | 8 |
| Offline session queue | 32 (LittleFS; drop oldest when full) |

### Markers (LCD column 15)

| Char | Mode | Meaning |
| --- | --- | --- |
| (space) | SYNCED | Phone reachable and authed — phone owns the live clock |
| `~` | OFFLINE | Phone unreachable — desk owns the timer offline |
| `?` | UNPAIRED | Token rejected — desk still offline-usable; fix token and reflash |
| `.` | BOOT / WIFI / DISCOVERING / CONNECTING | Connecting, boot probe, or reconnect pipeline |

### Enter SYNC (reconnect)

While the reconnect marker (`.`) is shown, the desk:

1. Accepts the first WebSocket `state` frame (phone reachable + authed).
2. Flushes the offline queue with `POST /api/sessions/import` and drops accepted
   `client_id`s (rejected rows stay queued / logged on serial).
3. If the desk still has a running/paused timer, may call `POST /api/timer/adopt`
   under the **least-remaining** rule: always when the phone is stopped; when
   both are live, only if desk remaining is strictly less than phone remaining;
   same session is always allowed.
4. On adopt `409` (phone remaining ≤ desk remaining on a different session) or
   when the desk does not try adopt (phone wins by remaining), snaps the
   display to phone state.
5. Caches `server_time` and `GET /api/config` to LittleFS for the next offline
   stretch. Config fetch retries once immediately on failure, then again while
   SYNCED (with the heartbeat) so phone setting changes still land.

While SYNCED, running countdowns project `remaining` with `server_time` (and
reject older/out-of-order frames for the same `start_time`+`phase`) so delayed
state cannot jump the display backward. Leave SYNC (stale socket, WS disconnect,
or WiFi loss) takes over the last remaining countdown locally (`~`). There is
never dual live ownership after merge: one winner; once SYNCED the phone owns
the sole live clock.

After the boot probe times out the desk is immediately usable offline (idle shows
`Pomo` + configured duration + `Press to start` + `~`), not a permanent
`Starting up 00:00`.

### Gestures

| Gesture | SYNCED | OFFLINE / UNPAIRED |
| --- | --- | --- |
| Single click | `POST /api/toggle` | local start / pause / resume |
| Double click | `POST /api/skip` | local skip phase |
| Triple click | `POST /api/reset` | local reset phase |
| Hold 1 s | `POST /api/extend` +300 s | local extend +300 s |

Boot probe (`.`, no local owner yet) ignores gestures. Rediscover while a local
timer is running keeps local control until enter-SYNC finishes.

Unpaired (`?`) is **not** a brick: the local Pomodoro still runs; only phone
sync waits until the token is fixed (copy from Settings into `secrets.h` and
reflash) or the 5‑minute cooldown retries.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Stuck on `.` during first boot | Wait ~45 s for the DISCOVERING boot probe to end, then offline mode (`~`) starts. Once the desk is CONNECTING, the handshake/hello wait uses a separate ~45 s socket-stale window (so `.` can last longer than the probe alone). If mDNS never works, set `POMO_HOST_FALLBACK` to the phone IP from Pomo Settings and reflash. |
| Always `~`, never space | Confirm Pomo is open (or the foreground service is running), phone API enabled, same Wi‑Fi, and the token in `secrets.h` matches Settings. Serial should show rediscover every ~90 s. |
| LCD shows `?` | Pairing token rejected. Re-copy the token from Pomo Settings into `secrets.h` and reflash. Local timer still works under `?`. |
| History missing after offline use | Open Pomo on the LAN; desk flushes on next successful enter-SYNC. Check Serial for `flush accepted=` / `flush row rejected`. Queue holds up to 32 sessions. |
| Phone was idle but desk timer did not transfer | Adopt runs when desk is running/paused and the phone is stopped (or same session). If both are live, a **shorter** desk remaining can still win (least remaining); if phone remaining ≤ desk remaining, phone keeps the clock and desk snaps (HTTP 409 `timer_busy`). Not always “phone already has a session → always snap.” Serial: `adopt result=…`. |
| Buzzer silent on skip | Expected — buzzer fires on natural phase complete only (phone event while SYNCED, local rundown while OFFLINE). |
| `LiquidCrystal_I2C::begin()` compile error | Wrong LCD library fork — see Libraries above. |
| Router blocks mDNS | Set `POMO_HOST_FALLBACK` (and port if not 9876) in `secrets.h`. Configured host wins outright and skips mDNS. |
| Desk never finds phone / port bind fails | Release and dev apps (`com.pomo` vs `com.pomo.dev`) both default to port **9876** — only one can listen. Force-stop or uninstall the other build, or change the port in Settings. |
| Wrong phone / wrong token on multi-device LAN | Desk probes every `_pomo._tcp` responder with `GET /api/status` + token and picks the first HTTP 200 — not the first mDNS answer. Serial: `mDNS candidate` / `selected N of M`. If every responder returns 401, marker becomes `?`. Prefer `POMO_HOST_FALLBACK` when you always want one phone. |

Serial at 115200 is the source of truth for connection debugging: look for
`mode OFFLINE -> DISCOVERING`, `enter SYNC pipeline`, `flush accepted=`, and
`adopt result=`.
