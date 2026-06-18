# CLAUDE.md

Lean repo guidance for agents working here.

## Project

- Android app: `com.pomo`
- Language: Kotlin
- Min SDK: 26
- Target SDK: 34
- Source of truth: Android phone

The phone owns timer state, settings, Room history, notifications, widgets, and
the embedded desktop-client API. Do not reintroduce laptop/server authority.

## Build

Requires JDK 17+ and Android SDK.

**Environment Setup:**
- Android SDK should be at `~/Android/Sdk` (standard location)
- Set `ANDROID_HOME="$HOME/Android/Sdk"` in `~/.zshrc`
- Build scripts prefer system SDK over local download

```bash
./build_apk.sh
```

Fast local dev build and tests use the unminified `devDebug` variant:

```bash
./gradlew assembleDevDebug
./run_tests.sh
```

Production release builds use the `prodRelease` variant with R8 minification and
resource shrinking:

```bash
./gradlew assembleProdRelease
```

## Useful ADB

```bash
adb install -r -g app/build/outputs/apk/dev/debug/app-dev-debug.apk
adb shell am start -n com.pomo/.MainActivity
adb logcat -s PomodoroService PhoneServer
```

## Architecture

```text
service/PomodoroService.kt   # canonical timer owner
timer/OfflineTimer.kt        # local countdown engine
db/                          # Room history and stats
network/PhoneServer.kt       # Ktor REST/WebSocket API
ui/                          # Timer, Stats, History, Settings, About
widget/TimerWidgetProvider.kt
```

State flow:

```text
PomodoroService -> OfflineTimer/Room -> UI, notification, widget, PhoneServer
```

## Development Rules

- Keep changes minimal and Kotlin-first.
- Read relevant files before editing.
- Do not restore old laptop sync paths.
- Treat Room as canonical history.
- History uses the phone's local calendar day. Sessions that cross midnight are
  split across dates; seconds are rounded up to minutes per date segment.
- Do not bump `versionCode`/`versionName` by hand; the `release.yml` workflow
  owns versioning (it rewrites them and commits `chore(release): bump version`).
- Run the narrowest relevant build/check before finishing.

## State Management Constraints

- `PomodoroService.stateSnapshot()` must be read-only. It returns a copy of
  current state without triggering any mutations, reconciliations, or side effects.
- Day transitions are handled in `executeCommand()` before state-modifying
  operations, not in read paths.
- Never call `reconcileDayTransitionIfNeeded()` from read-only operations like
  status queries, UI refreshes, or API polls—this would reset active timers
  crossing midnight.
