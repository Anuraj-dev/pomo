# NodeMCU hardware test — Windows continuation handoff

**For a Claude Code session on the Windows side of Raja's dual-boot.** The Linux
session's working ledger lives in `.superpowers/` which is gitignored, so this
doc is the complete, self-sufficient state. Do not re-plan or re-architect
anything — implementation is finished; only hardware verification remains.

## State as of 2026-07-22 (Linux session)

- Branch `feat/nodemcu-hardware-timer`, 20+ commits ahead of `main`.
- Pushed to the fork `Anuraj-dev/pomo` (Raja's GitHub account `Anuraj-dev`
  has **pull-only** access to upstream `Snehit70/pomo`).
- **PR #75 open:** https://github.com/Snehit70/pomo/pull/75 — the body carries
  four mandated disclosures (Task 2b behaviour fix, mDNS token residual,
  bounded-blocking limitation, nothing-run-on-hardware). Read it for context.
- **CI has never run.** The upstream run is `action_required` (fork PRs need a
  maintainer's "Approve and run" — only Snehit can click it). Actions is
  disabled on the fork. Unblock: Snehit approves on PR #75, OR Raja gets write
  access upstream, OR Raja enables Actions on `Anuraj-dev/pomo` and dispatches
  `ci.yml` on this branch there.
- The Android side test build: the `dev` flavor now has
  `applicationIdSuffix = ".dev"` and label **"Pomo Dev"**, so the test APK
  installs alongside the real Pomo app without touching its data. The
  self-updater is automatically disabled for non-`com.pomo` ids
  (`MainActivity.CANONICAL_APPLICATION_ID` check). Launch component is
  `com.pomo.dev/com.pomo.MainActivity`.
- Nothing in `firmware/` has ever been compiled — `arduino-cli` was not
  available on the Linux machine. First compile happens here, on Windows.

## Hard rules (carried from the Linux session)

- **Never commit `firmware/PomoLink/secrets.h`** (gitignored; verify with
  `git status --short` before any commit).
- **Do NOT change `Display.cpp`'s `lcd.begin()` to `lcd.init()`.** Verified
  against both library sources: de Brabander's LiquidCrystal_I2C (the Library
  Manager default, named in `firmware/README.md`) has a no-arg `begin()` and
  no `init()`. Two reviewers got this backwards already. If the compiler says
  `no member named 'begin'`, the WRONG library (johnrickman's fork) is
  installed — fix the library, not the code.
- Do NOT add a 5 V / I2C level-shifter warning to the README. Raja has months
  of direct operating evidence that NodeMCU VIN at 5 V with ~4.7 kΩ backpack
  pull-ups is fine; this was litigated and removed once already.
- No lint/tests/Gradle runs by agents — CI is the gate. No AI credits in
  commits or PR text.
- Do not claim the feature works until the checklist below passes on hardware.

## Known-accepted limitations (do not "fix" reactively)

- `HTTPClient::GET/POST`, `MDNS.queryService()` and the WebSocket connect are
  synchronous; the loop may stall ~1.5 s when the phone is unreachable
  (`kHttpTimeoutMs` = 1500). Raja chose bound-and-document over an async
  rewrite. Documented in a KNOWN LIMITATION block in `PomoClient.cpp`.
- With `POMO_HOST_FALLBACK` empty, the pairing token goes to the first
  `_pomo._tcp` responder on the LAN. Mitigation is setting the macro.
  Instance-name narrowing to `"Pomo"` is designed but unshipped — it needs the
  installed `ESP8266mDNS.h` to confirm the accessor. **Windows has the Arduino
  core installed, so this session MAY close it** if Raja asks, but it is not
  part of the hardware test.

## Hardware test procedure

Phone side first (can be done on either OS):

1. Build/install the branch's dev debug APK (**"Pomo Dev"**, installs
   alongside the real app; the real Pomo's data is untouched). Enable the
   phone API in Pomo Dev's Settings and copy the pairing token. Disable the
   phone API in the REAL Pomo app if it was on, so only one app binds the port
   and advertises.
2. Open `firmware/PomoLink/PomoLink.ino` in Arduino IDE. Copy
   `secrets.h.example` → `secrets.h`; fill WiFi SSID/password (2.4 GHz — the
   ESP8266 cannot see 5 GHz networks) and the pairing token from step 1.
   Leave `POMO_HOST_FALLBACK` empty initially.
3. Install libraries per `firmware/README.md` — de Brabander LiquidCrystal_I2C
   (the Library Manager default), Links2004 WebSockets, ArduinoJson. Board:
   NodeMCU 1.0 (ESP-12E). Wire per the README pin table.
4. Flash; open serial monitor at **115200**. Healthy boot: WiFi dots →
   `WiFi connected` + IP → mDNS query → resolved host:port → WebSocket
   connect → state frame → LCD leaves boot screen, shows `Pomo` + configured
   work duration.
5. Start on phone → LCD switches to `Focus`, counts down within ~1 s.
6. Single click → pause within ~1 s; again → resume. Double → skip.
   Triple → reset. Hold 1 s → +5 min.
7. Doze check: work phase to zero with phone screen off the whole time →
   buzzer reward melody, backlight blinks 3×, session lands in history.
8. Skip mid-phase → phone advances, buzzer stays silent.
9. Force-stop Pomo Dev → LCD `!` within 45 s, buttons dead. Reopen →
   reconnects and snaps to phone state.
10. Reboot router (new phone IP) → device rediscovers without reflash.
    Failure = router blocks mDNS → set `POMO_HOST_FALLBACK`, reflash;
    known-supported outcome, not a bug.
11. Rotate the pairing token in Settings → LCD `?`.

First-flash failure symptoms: endless WiFi dots = bad credentials or
5 GHz-only SSID. mDNS finds nothing = multicast blocked (see step 10). Blank
LCD with backlight = wrong I2C address (0x27 vs 0x3F) or SDA/SCL swapped.
`?` = token mismatch. `!` = phone resolved but unreachable.

## If something fails

Debug it here with the serial output as evidence (systematic-debugging:
reproduce → hypothesise → verify, no shotgun fixes). Commit fixes to this
branch, push to the `fork` remote (`Anuraj-dev/pomo`) — PR #75 updates
automatically. Record what changed and why in the commit message; the Linux
session will reconcile its ledger from the git log.
