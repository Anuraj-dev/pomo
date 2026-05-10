# Pomo

Pomo is a mobile-first Pomodoro timer for Android. The phone is the
canonical app: it owns the timer, settings, session history, notifications, and
widgets. Desktop integrations can pair with the phone and act as thin remote
clients.

This branch intentionally stops treating a laptop/server process as the source
of truth. Existing laptop history is not imported or merged.

## What It Does

- Runs a Pomodoro timer locally in an Android foreground service.
- Persists timer state across app restarts.
- Stores completed sessions and daily stats in Room.
- Splits sessions that cross midnight across local calendar days.
- Updates the Timer, Stats, History, notification, and home-screen widget from
  phone-owned state.
- Hosts a local HTTP/WebSocket API for desktop clients.
- Protects remote control with a pairing token.
- Includes a thin TypeScript desktop client for laptop display/control.

## Build

Requires JDK 17+.

Use the Gradle wrapper when the Android SDK is already configured. The dev
variant is unminified and is the fast local build:

```bash
./gradlew assembleDevDebug
```

Or use the lightweight builder, which bootstraps the local Android SDK in this
checkout before calling the wrapper:

```bash
./build_apk.sh
```

Debug APK:

```text
app/build/outputs/apk/dev/debug/app-dev-debug.apk
```

Production release APKs run R8 minification and resource shrinking:

```bash
./gradlew assembleProdRelease
```

Production APK:

```text
app/build/outputs/apk/prod/release/app-prod-release-unsigned.apk
```

## Run On A Device

```bash
adb install -r -g app/build/outputs/apk/dev/debug/app-dev-debug.apk
adb shell am start -n com.pomo/.MainActivity
```

Useful logs:

```bash
adb logcat -s PomodoroService PhoneServer
```

## Pair A Desktop Client

1. Open the Android app.
2. Go to Settings.
3. Tap "Pair desktop client".
4. Use the displayed JSON payload or QR code in the desktop client.

```json
{
  "url": "http://<phone-ip>:9876",
  "token": "<pairing-token>"
}
```

The phone must be reachable on the same network. The default API port is
`9876`, configurable in Settings.

Android Settings can copy/share the pairing payload, show it as a QR code, and
scan another Pomo pairing QR when an external ZXing-compatible scanner app
is installed.

## Desktop Client

The TypeScript desktop client stores pairing details, sends commands to the
phone API, and keeps a local stale cache for offline display. The cache is
best-effort: cache write failures do not make successful phone commands fail.

```bash
npm --prefix desktop-client install
npm --prefix desktop-client run build
node desktop-client/dist/cli.js pair-json '{"url":"http://<phone-ip>:9876","token":"<pairing-token>"}'
node desktop-client/dist/cli.js status
node desktop-client/dist/cli.js toggle
node desktop-client/dist/cli.js qr
```

The background service only refreshes the stale display cache:

```bash
node desktop-client/dist/cli.js service install
node desktop-client/dist/cli.js service start
node desktop-client/dist/cli.js service status
```

See [docs/desktop-client.md](docs/desktop-client.md) for service paths,
Waybar output, QR commands, and failure behavior.

## Architecture

```text
app/src/main/java/com/pomo/
├── MainActivity.kt
├── service/
│   ├── PomodoroService.kt        # Canonical timer owner
│   ├── NotificationHelper.kt
│   └── NotificationActionReceiver.kt
├── timer/
│   ├── TimerState.kt             # JSON-compatible state model
│   └── OfflineTimer.kt           # Local countdown engine
├── db/
│   ├── AppDatabase.kt
│   ├── HistoryDao.kt
│   ├── HistoryCacheRepository.kt # Room-backed canonical history access
│   ├── SessionEntity.kt
│   └── DayStatsEntity.kt
├── network/
│   └── PhoneServer.kt            # Embedded Ktor REST/WebSocket API
├── ui/
│   ├── TimerFragment.kt
│   ├── StatsFragment.kt
│   ├── HistoryFragment.kt
│   ├── SettingsFragment.kt
│   └── AboutFragment.kt
├── util/
│   ├── UtilPreferenceManager.kt
│   └── SoundManager.kt
└── widget/
    └── TimerWidgetProvider.kt
```

### State Flow

```text
User/notification/widget/API command
        ↓
PomodoroService
        ↓
OfflineTimer + Room history
        ↓
State broadcast
        ↓
Timer UI, Stats UI, History UI, notification, widget, WebSocket clients
```

`PomodoroService` is the write boundary. UI, notification buttons, widgets, and
remote clients all go through service methods. Room is the canonical history
store. The embedded API exposes the phone state; it does not merge state from a
desktop process.

## Remote API

See [docs/protocol.md](docs/protocol.md) for endpoint details, authentication,
payload shapes, and WebSocket behavior.

For a deeper implementation map, see [docs/architecture.md](docs/architecture.md).

For the thin TypeScript laptop client, see [docs/desktop-client.md](docs/desktop-client.md).

## Validation

Build check:

```bash
gradle assembleDevDebug
```

Manual checks worth doing on device:

- App starts and can run with no laptop/server process.
- Start, pause, resume, skip, reset, and extend all mutate phone state.
- Completed focus sessions appear in Today, Stats, History, notification, and
  widget.
- A focus session that crosses midnight is split across the two local calendar
  days, with seconds rounded up to minutes per day.
- Restarting the app restores stopped/paused/running timer state sensibly.
- `GET /api/status` rejects missing tokens and returns state with a valid token.
- `/ws` accepts a valid hello token and streams state updates.
- Desktop `status --waybar` shows fresh phone state when reachable and stale
  offline state when not.

## Releases

Releases are automated from `main`.

When a PR is merged, `.github/workflows/version-bump.yml` inspects the commit
messages in that push, bumps `versionCode` and `versionName` in
`app/build.gradle.kts`, commits the version bump back to `main`, and creates a
tag like `v1.5.1`.

The bump type follows Conventional Commits:

- `feat:` creates a minor release.
- `fix:` or `perf:` creates a patch release.
- `!` or `BREAKING CHANGE:` creates a major release.
- Anything else defaults to a patch release, so every merged PR can still ship.

When a `v*` tag is pushed, `.github/workflows/release.yml` builds the dev debug
and unsigned prod release APKs, uploads them as workflow artifacts, and
publishes a GitHub Release with generated release notes.

## Notes

- The embedded phone API is local-network HTTP protected by the pairing token;
  Android app-initiated cleartext traffic remains disabled in
  `network_security_config.xml`.
- The pairing token is stored in dedicated non-backed-up shared preferences.
- Legacy laptop/server sync classes were removed from the Android app.
