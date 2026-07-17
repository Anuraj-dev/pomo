# ABI APK Splits

Deferred — not worth the complexity today (single dev, 30MB APK, only native
lib is secp256k1). Revisit when native deps grow or APK is shared broadly.

## Current State

- Universal APK: **30MB**
- Only native lib: `secp256k1-kmp-jni-android` bundles 4 per-ABI `.so` files
  (~1.3MB each, ~5.4MB total)
- `release.yml` produces 1 APK; updater picks `first { .apk }` asset

## What to Change (3 files)

### 1. `app/build.gradle.kts` — enable splits

```kotlin
splits {
    abi {
        isEnable = true
        isUniversalApk = true
        reset()
        include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
    }
}
```

Gradle auto-generates: `app-universal-dev-debug.apk`,
`app-arm64-v8a-dev-debug.apk`, etc.

### 2. `GithubUpdateChecker.kt` — ABI-aware asset selection

`resolveUpdate()` currently does:

```kotlin
val apk = assets.firstOrNull { it.name.endsWith(".apk") }
```

Needs to:

1. Detect device ABI: `Build.SUPPORTED_ABIS[0]`
2. Filter assets by naming convention: `pomo-VERSION-ABI.apk`
3. Fall back to universal if no ABI match
4. Match `.sha256` companion to the selected APK

### 3. `release.yml` — build and upload 5 APKs

Per Animetail's pattern:
```
pomo-VERSION.apk              (universal)
pomo-VERSION-arm64-v8a.apk
pomo-VERSION-armeabi-v7a.apk
pomo-VERSION-x86.apk
pomo-VERSION-x86_64.apk
```

Collect all 5 in `release-artifacts/`, each with a `.sha256` sidecar.

## Gotcha: versionCode

Gradle ABI splits auto-increment `versionCode` per ABI (universal=N, arm64=N+1,
etc.). This is fine — phone just needs `versionCode > installed` for in-place
update. But `release.yml` bumps base `versionCode` via `perl`, so the base
value must be bumped, not per-ABI.

## Reference: Animetail

- Repo: `Animetailapp/Animetail`
- Build: `splits { abi { isEnable = true; isUniversalApk = true } }`
- Release: 5 APKs uploaded with SHA-256 checksums in release body
- No in-app ABI filtering — users pick manually from GitHub releases page
