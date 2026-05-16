# PLAN.md

Phase-wise implementation plan for the Pomo frontend upgrade. Each phase is independently shippable, ends on a working `assembleDevDebug`, and increments `versionCode` and `versionName` per project rule. Run `./run_tests.sh` before closing each phase.

Branch: `feat/frontend-improve`. Merge to `main` per phase or batch as agreed.

Read order for context: `PRODUCT.md`, `DESIGN.md`, then this file.

---

## Phase 1: Foundation tokens

Goal: replace the current theme primitives so every later phase consumes the new system.

Tasks:

1. Rewrite `ui/theme/Color.kt` with the OKLCH-derived tokens from `DESIGN.md`. Convert OKLCH to sRGB at compile time, expose as `Color(...)` constants. Keep names matching DESIGN.md tokens exactly.
2. Add `ui/theme/Light.kt` with the light color scheme. Wire `PomoTheme` to select light or dark via a new `ThemeMode` setting (system, light, dark). Read from preferences, default to system.
3. Rewrite `ui/theme/Type.kt` with the typography scale from DESIGN.md. Bundle JetBrains Mono and Inter under `app/src/main/res/font/`. Enable `fontFeatureSettings = "tnum"` on the timer text style.
4. Add `ui/theme/Shape.kt` with the radius tokens.
5. Add `ui/theme/Spacing.kt` with the 4 sp grid constants.
6. Add `ui/theme/Motion.kt` with the duration and easing tokens.
7. Update `themes.xml` so the system status and navigation bars match the new bg in both themes.

Verification:

- `./gradlew assembleDevDebug` succeeds.
- Visual diff on Timer screen shows new background and new digit font; no other regression.
- Toggle ThemeMode setting (even if exposed only via temporary debug menu) flips light and dark live.

APK size budget: +250 KB max for both fonts. If over, drop Inter weights 400 and 700 only and synthesize 500 and 600.

---

## Phase 2: Component library

Goal: build the shared components every screen will consume.

Tasks:

1. Create `ui/components/` package.
2. Implement `PomoButton.kt` with filled, tonal, ghost variants. Include haptic on press, all interaction states.
3. Implement `PhaseChip.kt`.
4. Implement `StatTile.kt`.
5. Implement `SectionHeader.kt`.
6. Implement `EmptyState.kt`.
7. Implement `Sheet.kt` wrapper around `ModalBottomSheet` with consistent header.
8. Implement `SegmentedToggle.kt`.
9. Implement `Snackbar.kt` host with the project's defaults baked in.
10. Add a hidden `?gallery` route or debug build flag that renders every component in every state for visual review.

Verification:

- Gallery screen renders all components in both themes.
- Each component compiles in isolation in `androidx.compose.ui.tooling.preview.Preview`.

---

## Phase 3: Timer screen rebuild

Goal: ship the hero. This is the screen users open every time.

Tasks:

1. Replace the current `TimerScreen.kt` layout with the structure in DESIGN.md (header, phase queue, hero ring, stats strip, controls).
2. Rebuild `TimerRings` so the outer goal ring is segmented into N arcs with 4 dp gaps. Each arc fills when its session completes.
3. Add the phase-tinted radial glow behind the ring using `Brush.radialGradient`.
4. Replace the existing `StatsCard` with the inline `StatTile` strip and hairline dividers. Make it tappable, route to Stats.
5. Replace controls: 80 dp FAB, 56 dp ghost Skip on the left, long-press Reset on the right. Implement the Reset hold-to-confirm with the icon fill animation (linear 600 ms; release early cancels).
6. Add phase transition animation: ring color cross-fade, glow cross-fade, slide-up caps label, medium haptic.
7. Add goal-reached one-shot bloom; gate behind a "first time today" check so it does not replay on every recomposition.
8. Add the pause breathing animation, gated by reduced-motion check.
9. Add the session-count slot-machine roll on increment.
10. Set `Modifier.semantics { liveRegion = Polite }` on the timer digits.

Verification:

- Start, pause, resume, skip, reset all work and animate per spec.
- Phase transition triggers exactly once on real timer expiry (not on recomposition or rotation).
- Reset long-press cancels cleanly if released early.
- Reduced motion strips animations.
- Manual test on a real device confirms ring is readable from one meter.

---

## Phase 4: Stats screen overhaul

Goal: turn the 648-line current screen into the layout in DESIGN.md.

Tasks:

1. Delete the unused sections of the current `StatsScreen.kt` once the new structure replaces them. Do not preserve dead code.
2. Add range toggle backed by a `ViewModel` state.
3. Implement the hero line with delta vs previous period.
4. Build `Heatmap.kt` component. Reads daily aggregates from Room. Tap pushes navigation to History with a date filter argument.
5. Build `HourDistribution.kt`. Reads hour-bucketed aggregates from Room. Render with `Canvas`.
6. Implement streak block with current and longest from existing stats source.
7. Implement goal completion ring next to a 30-day percentage.
8. Hook empty state: when range count is 0, collapse content sections into `EmptyState` with a CTA to the Timer tab.

Verification:

- Range toggle re-queries and re-renders inside 240 ms.
- Heatmap cells reflect real data in `adb logcat -s PomodoroService` after running a session.
- Tap on a heatmap cell lands on History with that day filtered.

Schema or query changes likely required for hour-bucketed aggregates; if so, add a Room migration and a unit test covering it.

---

## Phase 5: History and Settings

Goal: bring the remaining two utility screens up to the system.

History tasks:

1. Group by day with sticky `SectionHeader`s.
2. Row layout per DESIGN.md, using `PhaseChip` and `StatTile` text styles.
3. Swipe-to-delete with undo via `Snackbar`. Implement undo by deferring the actual Room delete by 4 seconds.
4. Swipe-to-edit-tag opens a `Sheet`. Persist tag changes.
5. Custom pull-to-refresh indicator: a phase-colored ring that fills with gesture progress.
6. Empty state when no sessions.

Settings tasks:

1. Restructure into sections (Timer, Notifications, Theme, Desktop client, Advanced), each wrapped in a `Card` at `radius.lg`.
2. Duration controls become sliders snapped to 1 minute, with the value rendered in 24 sp `timer` style on the right.
3. Add Theme section with ThemeMode (system, light, dark) and the optional "match system color" toggle.
4. Desktop client section shows current LAN status, port, and a copyable URL.
5. Advanced section: export history (CSV), reset all (`danger` color, confirm `Sheet`).

Verification:

- History undo works; deleted item reappears if snackbar action is hit, disappears for good after 4 s.
- Theme toggle takes effect without app restart.
- All Settings entries scroll cleanly at 200 percent font scale.

---

## Phase 6: Widget and dynamic color

Goal: finish coverage outside the app surface.

Tasks:

1. Redesign `widget_timer.xml` to match in-app ring and digits. Implement both 2x2 and 4x2 sizes.
2. Hook widget colors to a color state list so light and dark match the system.
3. Add Material You dynamic color path on Android 12+, gated by the "match system color" Settings toggle. When on, neutrals follow `dynamicDarkColorScheme` and `dynamicLightColorScheme`; phase, accent, success, warn, danger remain canonical.
4. Verify widget update cadence: once per minute when running, immediate on phase change. Add a brief unit test on the update scheduler.

Verification:

- Place both widget sizes on launcher; phase change reflects within 2 s.
- Toggle dynamic color in Settings; widget and app neutrals shift, phase colors do not.

---

## Phase 7: Accessibility, harden, polish

Goal: production quality. Nothing decorative remains undone.

Tasks:

1. Pass every screen with TalkBack on a real device. Add or fix `contentDescription` and `semantics` as needed.
2. Confirm WCAG AA contrast on every text surface in both themes. Adjust `onSurfaceMuted` per theme if any pair fails.
3. Confirm 200 percent font scale on every screen. Fix any clipped or overlapping elements.
4. Verify all interactive components have all states defined per DESIGN.md (default, pressed, focused, disabled, loading where applicable).
5. Confirm reduced-motion path strips every animation listed in DESIGN.md Motion section.
6. Run `./run_tests.sh` and `./gradlew assembleProdRelease` clean.
7. Bump `versionCode` and `versionName`.
8. Update screenshots in any release-notes location.

Verification:

- Manual a11y pass logged in commit message.
- `assembleProdRelease` succeeds with R8 minification on, no missing rules for bundled fonts.

---

## Out of scope for this upgrade

- Cross-device sync beyond the existing LAN client.
- Onboarding flow (the product principle is no setup; current behavior stays).
- Localization beyond English; if added later, audit caps labels for tracking.
- Tablet-specific layouts beyond the 420 dp ring sizing already noted.

---

## Suggested PR cadence

- PR 1: Phase 1.
- PR 2: Phase 2 plus debug gallery route.
- PR 3: Phase 3.
- PR 4: Phase 4.
- PR 5: Phase 5.
- PR 6: Phase 6.
- PR 7: Phase 7, including release version bump.

Each PR includes before/after screenshots of every screen it touches in both themes.
