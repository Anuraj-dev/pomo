---
status: accepted
---

# In-app update checker over GitHub Releases

## Context

Pomo is distributed by sideloading: CI publishes a signed debug APK to a GitHub
Release (`Snehit70/pomo`), tagging `v<versionName>` and attaching
`pomo-<version>-dev-debug.apk` plus a companion `.sha256`. There is no Play
listing, so Play in-app updates are unavailable and users have no built-in way to
learn a newer build exists. Crucially, CI signs every release with a **stable
debug keystore** (`androiddebugkey`); the release workflow fails hard if that
secret is missing precisely because an ephemeral key would break in-place
updates. That signing continuity is what makes a self-contained updater possible.

## Decision

Add a **manual** "Check for updates" flow on the **About** screen that downloads
and installs the new APK in-app.

Concrete rules:

1. **Manual, ephemeral.** The user taps to check; there is no background polling,
   check-on-launch, or persisted "update available" flag. Each visit to About
   starts at Idle. This keeps us well under GitHub's 60 req/hr unauthenticated
   limit and avoids stale-flag bugs.
2. **Newer = semver from the tag.** Query `GET /releases/latest` (which already
   excludes drafts and pre-releases), strip the leading `v`, and compare
   `MAJOR.MINOR.PATCH` numerically against `BuildConfig.VERSION_NAME` (with any
   `-demo` suffix stripped first). `versionCode` is *not* used — it isn't exposed
   in release metadata. An unparseable tag is treated as "no update" (fail safe).
3. **Single APK by suffix.** Select the lone release asset whose name ends in
   `.apk`. No per-ABI splits. A release with no `.apk` asset is the explicit
   "missing-asset" error state, not a crash.
4. **Download in-app, then install (chosen over a browser handoff).** Stream the
   APK with OkHttp (already in the app) into app-private `cacheDir/updates/`,
   verify it against the release's `.sha256` asset, then hand the file to the
   system installer via a `FileProvider` content URI. This requires the
   `REQUEST_INSTALL_PACKAGES` permission; if `canRequestPackageInstalls()` is
   false we route the user to the "install unknown apps" settings screen rather
   than failing silently.
5. **Gated to the canonical app.** The updater is shown only when running
   `com.pomo`. The `.demo` build (separate `applicationId`) hides it, because
   installing the CI APK there would drop a second app rather than update. A
   developer-local `com.pomo` build signed with a different debug key will fail
   the OS signature check; that surfaces through the normal "can't install"
   state rather than special handling.

## Considered alternatives

- **Browser/installer handoff** (open the release page or asset URL, let the user
  install manually). Zero new permissions and no FileProvider, but worse UX —
  no integrity check before the installer runs, and a clumsier multi-app-switch
  flow. Rejected in favor of an integrated download given the sideload model is
  the *only* distribution path.
- **Compare on `versionCode`.** Cleaner monotonic integer, but it isn't in the
  GitHub release metadata, so it would require plumbing it into the asset name or
  release body — coupling the app to a CI artifact convention. Rejected; the tag
  is already the release's identity.
- **Signing-cert pinning** to pre-detect un-updatable installs (demo / local
  debug builds). Catches both cases cleanly but bakes a cert fingerprint into the
  app for marginal polish. Rejected in favor of the simpler `applicationId` gate
  plus the installer's natural failure.
- **Skip sha256, lean on the install-time signature check.** The signature check
  blocks *malicious* swaps but gives a generic OS failure for the common case (a
  truncated/flaky download). Verifying the published `.sha256` first lets us show
  a clean "download corrupted, try again" state. Rejected skipping it.

## Consequences / implementation pointers

- New manifest permission `REQUEST_INSTALL_PACKAGES` and a `FileProvider`
  (authority `com.pomo.fileprovider`) serving `cacheDir/updates/`. A focus timer
  requesting install-packages is surprising without this ADR — that's why it's
  recorded.
- The flow leans on CI's stable-keystore signing (see the release workflow's
  hard failure when `DEBUG_KEYSTORE_BASE64` is unset). If release signing ever
  moves to a different key, in-place updates across that boundary break.
- About-screen state machine spans: Idle → Checking → {Up-to-date, Update
  available (with release notes from the `body`)} → Downloading → Verifying →
  Installing, plus error states: offline, rate-limited (HTTP 403 +
  `X-RateLimit-Remaining: 0`), malformed metadata, missing asset, corrupt
  download (sha mismatch), and can't-install (no install permission).
- Network call uses the existing OkHttp dependency; no new HTTP library.
