# PomoLink — NodeMCU desk device

An ESP8266 NodeMCU that mirrors and controls the Pomo timer over your LAN. It is
a thin client: the phone owns the timer, this device displays it and sends
commands. It never runs a timer of its own.

See `docs/protocol.md` for the API it speaks and
`docs/superpowers/specs/2026-07-22-nodemcu-hardware-timer-design.md` for the design.

## Hardware

| Component | NodeMCU pin |
| --- | --- |
| 16x2 I2C LCD, SDA | D2 |
| 16x2 I2C LCD, SCL | D1 |
| 16x2 I2C LCD, VCC / GND | VIN (5V) / GND |
| Passive buzzer, + | D5 |
| Passive buzzer, - | GND |
| Button | GPIO0 (the onboard FLASH button — nothing to wire) |

The LCD is addressed at `0x27`. If yours is at `0x3F`, change `kLcdAddress` in
`Display.cpp`.

## Libraries

Install through the Arduino IDE Library Manager unless noted.

| Library | Version | Notes |
| --- | --- | --- |
| esp8266 boards | 3.1.x or newer | Boards Manager URL: `https://arduino.esp8266.com/stable/package_esp8266com_index.json` |
| ArduinoJson (bblanchon) | 7.x | v6 will not compile — this code uses `JsonDocument` |
| arduinoWebSockets (Links2004) | 2.4.0 or newer | |
| LiquidCrystal_I2C (johnrickman) | 1.1.4 or newer | See the warning below — the wrong library of this name will not compile |

`ESP8266WiFi`, `ESP8266mDNS`, `ESP8266HTTPClient` and `Wire` ship with the board
package.

**Two different libraries are called "LiquidCrystal I2C".** Searching the Library
Manager finds Frank de Brabander's 1.1.2 first, and `Display.cpp` will not compile
against it: it exposes `init()` and `begin(cols, rows, charsize)`, with no
no-argument `begin()`. Install John Rickman's `johnrickman/LiquidCrystal_I2C`
instead — from https://github.com/johnrickman/LiquidCrystal_I2C via Sketch →
Include Library → Add .ZIP Library. If you see `no matching function for call to
'LiquidCrystal_I2C::begin()'`, you have the wrong one installed.

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

Open Serial Monitor at 115200 baud to watch discovery and connection state.

## Troubleshooting

| LCD shows | Meaning |
| --- | --- |
| `.` in the bottom-right | Connecting to WiFi, discovering the phone, or opening the WebSocket |
| `!` in the bottom-right | Phone unreachable. Check Pomo is running and the phone API is enabled in Settings. |
| `?` in the bottom-right | Token rejected. Re-copy the pairing token into `secrets.h` and reflash. |

If it never gets past `.`, your router probably blocks mDNS multicast. Set
`POMO_HOST_FALLBACK` in `secrets.h` to the phone's IP (shown in Pomo Settings)
and reflash.
