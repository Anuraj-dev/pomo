# PomoLink — NodeMCU desk device

An ESP8266 NodeMCU that mirrors and controls the Pomo timer over your LAN, and
runs a full local Pomodoro when the phone is unreachable.

- **SYNCED (space marker):** the phone is the sole live clock. The desk displays
  WebSocket (+ REST) state, sends REST commands, and buzzes on phone
  `phase_complete` events.
- **OFFLINE (`~`) / UNPAIRED (`?`):** the desk owns countdown, buzzer, and
  buttons. Completed sessions are queued for flush on reconnect (history import
  + optional live-timer adopt). A live offline timer also survives reboot via
  LittleFS `/pomo_timer.json`. There is never dual live ownership.

**You do not need a special sync gesture.** Opening the Pomo app on the same
Wi‑Fi (so the phone API and mDNS advertisement are up) is enough: while offline
the desk retries rediscovery every 5 s, plus REST reachability probes against a
known host every 5 s, then reconnects, flushes history, and may adopt a live
timer. Pairing token must
already be in `secrets.h`.

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
| Boot probe budget | Two sequential ~45 s windows: WiFi wait up to ~45 s, then after association a **fresh** DISCOVERING window of ~45 s (worst case ~90 s to offline-usable). Missing SSID / WiFi hard-fail or either timeout → OFFLINE (`~`), not stuck on `Starting up` |
| CONNECTING handshake / hello wait | ~20 s socket-stale window (boot watchdog does not hard-cut CONNECTING or abort enter-SYNC) |
| Rediscover/reconnect interval | fixed ~5 s; plus REST reachability probe of known host every ~5 s (skips mDNS when REST proves the host) |
| SYNCED socket stale / WS loss | ~20 s without a WS frame → soft resync; phone ownership is retained while REST is reachable, then fixed-interval OFFLINE recovery after the safety limit |
| Unpaired token-reject cooldown | 5 min, then rediscover |
| Local durations (work / short / long) | 25 / 5 / 15 min (cached from phone) |
| Long break after N completed work blocks | 4 |
| Daily goal (display) | 8 default; `0` is valid (LCD shows `N today` without `/goal`) |
| Offline session queue | 32 (`/pomo_sessions.json`; temp+rename writes; drop oldest when full) |
| Live offline timer snapshot | `/pomo_timer.json` (temp+rename); restored on boot for running/paused; cleared when SYNCED or stopped |

### Markers (LCD column 15)

| Char | Mode | Meaning |
| --- | --- | --- |
| (space) | SYNCED | Phone reachable and authed — phone owns the live clock |
| `~` | OFFLINE | Phone unreachable — desk owns the timer offline |
| `?` | UNPAIRED | Token rejected — desk still offline-usable; fix token and reflash |
| `.` | BOOT / WIFI / DISCOVERING / CONNECTING | Connecting, boot probe, or reconnect / enter-SYNC pipeline |

### Enter SYNC (reconnect)

While the reconnect marker (`.`) is shown, the desk:

1. Accepts the first proof of a healthy phone from a WebSocket `state` frame.
   REST probes while `CONNECTING` only check reachability/token; they never
   promote the desk to SYNCED. HTTP 401 becomes UNPAIRED (`?`).
2. Flushes the offline queue with `POST /api/sessions/import` and drops only
   accepted `client_id`s. Rejected, unaccepted, transport-failed, or malformed
   imports stay queued and keep the desk in `CONNECTING`; the same pipeline is
   retried every 5 s. Implausible `start` values are stripped before flush so
   the phone can assign wall time.
3. If the desk still has a running/paused timer, may call `POST /api/timer/adopt`
   under the **least-remaining** rule: always when the phone is stopped; when
   both are live, only if desk remaining is strictly less than phone remaining;
   same session is always allowed. Live adopt requires `start_time > 0` (desk
   stamps real phase starts when it has an epoch basis).
4. On adopt `409` (phone remaining ≤ desk remaining on a different session) or
   when the desk does not try adopt (phone wins by remaining), snaps the
   display to phone state. Adopt transport fail keeps the local timer only if
   the phone was stopped; if the phone was already live, the desk snaps.
5. Caches `server_time` and refreshes `GET /api/config` only after SYNC is
   stable, so the import/adopt pipeline does not starve the WebSocket loop.
   Healthy config refresh is ~5 min; a failed refresh retries after ~1 min so
   phone setting changes still land. `daily_goal` `0` is accepted.

While SYNCED, state is applied **before** re-anchoring the epoch cache so lag
projection can use the prior basis: running countdowns project `remaining` with
`server_time` / wall-clock now, and reject older/out-of-order frames for the same
`start_time`+`phase` that would inflate remaining (unless `duration` grew via
extend). Leave SYNC (stale socket, WS disconnect, or WiFi loss) takes over the
last remaining countdown locally (`~`). A dropped or stale WebSocket first
attempts soft resync without taking over the local clock; if the phone is
unreachable or the soft-resync safety limit is reached, fixed-interval reconnect
returns to OFFLINE. There is never dual live ownership after merge: one winner;
once SYNCED the phone owns the sole live clock.

After the boot probe budget times out (or WiFi hard-fails), the desk is
immediately usable offline (idle shows `Pomo` + configured duration +
`Press to start` + `~`), not a permanent `Starting up 00:00`. A live
running/paused timer restored from `/pomo_timer.json` continues after reboot;
session history prefers the real phase `start_time` when enqueuing (fallback:
completion − duration only when start was never stamped).

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
| Stuck on `.` during first boot | WiFi wait can take up to ~45 s; after association, DISCOVERING gets another ~45 s (probe clock restarts on WiFi up). After either window times out (or WiFi hard-fails), offline mode (`~`) starts. Once the desk is CONNECTING, the handshake/hello wait uses the socket-stale window. If mDNS never works, set `POMO_HOST_FALLBACK` to the phone IP from Pomo Settings and reflash. |
| Always `~`, never space | Confirm Pomo is open (or the foreground service is running), phone API enabled, same Wi‑Fi, and the token in `secrets.h` matches Settings. Serial should show `schedule rediscover in 5000 ms` and, with a known host, REST probes while OFFLINE. |
| LCD shows `?` | Pairing token rejected. Re-copy the token from Pomo Settings into `secrets.h` and reflash. Local timer still works under `?`. |
| History missing after offline use | Open Pomo on the LAN; desk retries the import every 5 s and enters SYNC only after all rows are accepted. Check Serial for `flush accepted=` / `flush row rejected`. Queue holds up to 32 sessions. |
| Phone was idle but desk timer did not transfer | Adopt runs when desk is running/paused and the phone is stopped (or same session). If both are live, a **shorter** desk remaining can still win (least remaining); if phone remaining ≤ desk remaining, phone keeps the clock and desk snaps (HTTP 409 `timer_busy`). Not always “phone already has a session → always snap.” Serial: `adopt result=…`. |
| Buzzer silent on skip | Expected — buzzer fires on natural phase complete only (phone event while SYNCED, local rundown while OFFLINE). |
| `LiquidCrystal_I2C::begin()` compile error | Wrong LCD library fork — see Libraries above. |
| Router blocks mDNS | Set `POMO_HOST_FALLBACK` (and port if not 9876) in `secrets.h`. Configured host wins outright and skips mDNS. |
| Desk never finds phone / port bind fails | Release and dev apps (`com.pomo` vs `com.pomo.dev`) both default to port **9876** — only one can listen. Force-stop or uninstall the other build, or change the port in Settings. |
| Wrong phone / wrong token on multi-device LAN | Desk probes every `_pomo._tcp` responder with `GET /api/status` + token and picks the first HTTP 200 — not the first mDNS answer. Serial: `mDNS candidate` / `selected N of M`. If every responder returns 401, marker becomes `?`. Prefer `POMO_HOST_FALLBACK` when you always want one phone. |

Serial at 115200 is the source of truth for connection debugging: look for
`mode OFFLINE -> DISCOVERING`, `enter SYNC pipeline`, `flush accepted=`,
`session import incomplete`, and `adopt result=`.
