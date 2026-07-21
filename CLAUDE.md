## Build

Requires JDK 17+ and Android SDK.

**Environment Setup:**

- Android SDK should be at `~/Android/Sdk` (standard location)
- Set `ANDROID_HOME="$HOME/Android/Sdk"` in `~/.zshrc`
- Build scripts prefer system SDK over local download

```bash
./build_apk.sh
```

## Useful ADB

```bash
adb install -r -g app/build/outputs/apk/dev/debug/app-dev-debug.apk
adb shell am start -n com.pomo/.MainActivity
adb logcat -s PomodoroService PhoneServer
```

## Development Rules

- Do NOT run lint or tests locally. Just create a branch, commit, and open a PR.
  CI/CD handles formatting, linting, and testing. Local runs muddy the setup.
- Treat Room as canonical history.
