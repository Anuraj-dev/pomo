# DESIGN.md

Design system for the Pomo Android app. Kotlin, Jetpack Compose, Material 3 as substrate. Values below are tokens; the implementation in `ui/theme/` is the source of truth once shipped.

## Theme

Scene sentence: a knowledge worker mid-afternoon in a sunlit office glancing at their phone for the next break, or a student late at night doing one more focus block in a dim dorm. The same person, different hours.

Conclusion: dark default for energy efficiency on OLED and for the late-night case, light theme as a real first-class option, follow system by default. Theme is a setting, not a flourish.

## Color

Strategy: **Restrained** with one semantic accent axis. The phase color (coral or teal) carries state across the entire surface. Gold is reserved for goal and streak. Everything else is a tinted neutral.

All values in OKLCH so lightness and chroma are predictable across themes. No `#000`, no `#fff`. Neutrals are tinted toward the coral hue (warm) so cold blue is never the residual feel.

### Dark (default)

| Token | OKLCH | Use |
|---|---|---|
| `bg` | `oklch(0.06 0.006 25)` | App background, near-black, warm tint |
| `surface` | `oklch(0.13 0.008 25)` | Cards, inline panels |
| `surfaceElevated` | `oklch(0.18 0.008 25)` | Sheets, modals, menus |
| `outline` | `oklch(0.28 0.010 25)` | Hairlines, ring tracks, dividers |
| `outlineStrong` | `oklch(0.42 0.012 25)` | Pressed states, focus rings |
| `onSurface` | `oklch(0.96 0.006 25)` | Primary text |
| `onSurfaceMuted` | `oklch(0.72 0.008 25)` | Secondary text, labels |
| `onSurfaceFaint` | `oklch(0.52 0.008 25)` | Tertiary text, disabled |
| `focus` | `oklch(0.72 0.17 25)` | Work phase color |
| `focusGlow` | `oklch(0.72 0.17 25) / 0.18` | Ambient glow under timer |
| `break` | `oklch(0.80 0.13 175)` | Break phase color |
| `breakGlow` | `oklch(0.80 0.13 175) / 0.18` | Ambient glow under timer |
| `accent` | `oklch(0.85 0.13 85)` | Streak, goal completion |
| `success` | `oklch(0.78 0.16 145)` | Connection ok |
| `warn` | `oklch(0.78 0.15 65)` | Offline, sync lag |
| `danger` | `oklch(0.70 0.18 25)` | Destructive confirm only |

### Light

| Token | OKLCH | Use |
|---|---|---|
| `bg` | `oklch(0.985 0.004 85)` | Warm off-white, paper feel |
| `surface` | `oklch(1.00 0.000 0)` minus 2 percent | Pure surface (still tinted via container) |
| `surfaceElevated` | `oklch(0.97 0.005 85)` | Sheets |
| `outline` | `oklch(0.88 0.008 85)` | Hairlines |
| `onSurface` | `oklch(0.18 0.010 25)` | Primary text |
| `onSurfaceMuted` | `oklch(0.42 0.010 25)` | Secondary |
| `focus` | `oklch(0.58 0.18 25)` | Darker, denser coral for contrast |
| `break` | `oklch(0.55 0.13 175)` | Darker mint for contrast |
| `accent` | `oklch(0.70 0.13 85)` | Goal complete |

Contrast targets: every `onSurface*` pair passes WCAG AA against its surface. Phase colors are tested both as foreground (text on surface) and background (FAB fill, ring stroke).

### Dynamic color (Android 12+)

Off by default. The phase color carries semantic meaning that dynamic color would dilute. Offer a "match system color" toggle in Settings for users who prefer it; when enabled, only neutrals are remapped, phase colors remain canonical.

## Typography

Two families, both bundled to remove OEM variance. System fonts are legitimate for product UI generally, but the timer is the product, so its numerals get fixed treatment.

- **JetBrains Mono** for timer digits and tabular numbers in stats. Feature flag `tnum` enabled so digits do not jitter as they tick. Weight 600.
- **Inter** for everything else. Weights 400, 500, 600, 700.

Scale (fixed sp, no fluid clamps):

| Role | Family | Weight | Size | Tracking |
|---|---|---|---|---|
| `timer` | JetBrains Mono | 600 | 72 sp | -0.02em |
| `display` | Inter | 700 | 32 sp | -0.01em |
| `headline` | Inter | 600 | 22 sp | -0.005em |
| `title` | Inter | 600 | 17 sp | 0 |
| `body` | Inter | 400 | 15 sp | 0 |
| `bodySmall` | Inter | 400 | 13 sp | 0 |
| `label` | Inter | 500 | 12 sp | 0 |
| `caps` | Inter | 600 | 11 sp | +0.12em, uppercase |

Step ratio between display, headline, title, body, label sits at 1.2 to 1.25. Tight enough to feel like one system, loose enough to read as hierarchy.

## Spacing and shape

Single 4 sp grid. Used values: 4, 8, 12, 16, 20, 24, 32, 40, 56.

Corner radii:

- `radius.sm` 8 dp, chips and small controls.
- `radius.md` 14 dp, buttons and inline surfaces.
- `radius.lg` 20 dp, cards and sheets.
- `radius.pill` 999 dp, status pills and capsule buttons.
- `radius.circle` 50 percent, FAB and avatar.

Elevation is implied through outline strength and surface lightness, not Material shadow. Shadows on a true-black background look like grey smudges.

## Motion

Tokens (single `Motion.kt`):

```text
durationXS  = 120 ms   ripple, hover, tap feedback
durationS   = 180 ms   buttons, chips, selection
durationM   = 240 ms   navigation, tab switches, sheets
durationL   = 360 ms   phase transition, goal celebrate
easeStandard = CubicBezier(0.2, 0.0, 0.0, 1.0)   Material emphasized out
easeOutQuint = CubicBezier(0.22, 1.0, 0.36, 1.0)
easeOutExpo  = CubicBezier(0.16, 1.0, 0.30, 1.0)
```

No bounce, no elastic, no overshoot. Springs only as the underlying physics, not as a visual flourish.

State motion (everything else is none):

- **Timer start**: ring fills 0 to current progress in 360 ms ease-out-quint, then begins drain. FAB scales 0.94 to 1.0 in 180 ms, light haptic tick.
- **Timer pause**: ring stroke opacity drops to 0.55 in 240 ms. Digits gently breathe (scale 1.0 to 1.015 and back over 1.6 s, infinite). Signals waiting.
- **Phase transition**: ring color cross-fades over 360 ms; background glow cross-fades; medium haptic. A small caps label slides up from below the digits with the new phase name, holds 600 ms, fades out.
- **Goal reached**: outer ring completes its last segment with a 360 ms ease-out-expo sweep, then a one-shot 480 ms gold bloom (radial expansion to 1.4x, opacity 0.4 to 0). Plays once per day.
- **Session count tick**: number rolls upward with a 280 ms vertical translate of two digit slots, no easing past linear.
- **Tab navigation**: shared X axis, 240 ms, ease-standard.
- **List enter (History)**: stagger 30 ms per row, max 8 rows, then no animation on scroll.

Reduced motion: when `Settings.Global.TRANSITION_ANIMATION_SCALE == 0`, every transition collapses to a 0 ms cross-fade. The pause breathing animation stops entirely.

Haptics:

- Light tick: start, pause, tab switch, swipe action commit.
- Medium impact: phase complete.
- `HapticFeedbackConstants.CONFIRM`: goal reached.
- No haptics during scroll, drag, or idle.

## Components

Lives in `ui/components/`. Every interactive component defines: default, pressed, focused, disabled, loading. No half-spec components ship.

- `PhaseRing` — the dual concentric ring on the timer screen. Outer ring is the daily goal, rendered as N discrete arcs (one per goal session) with 4 dp gaps. Inner ring is the current phase progress, single smooth arc. Both 14 dp stroke, rounded caps.
- `PhaseChip` — capsule with phase color background at 0.18 opacity and phase color text. Used on history rows and the current phase label.
- `StatTile` — value, label, optional delta. Used in stats summary and the timer footer strip. No card wrapper; sits directly on background with hairline divider.
- `PomoButton` — three variants. `filled` (phase color background), `tonal` (phase color at 0.18 on neutral), `ghost` (icon only or text only). Built-in haptic on press. 48 dp min tap target.
- `SegmentedToggle` — used in Stats for time-range selection (Week, Month, All).
- `SectionHeader` — caps label with 12 sp tracking, used in Settings and Stats.
- `EmptyState` — icon, headline, body, optional action. One component, used on History, Stats empty days, About if offline.
- `Sheet` — bottom sheet wrapper with consistent header (title left, close right) and content padding. Replaces inline modals.
- `Snackbar` — single-line message, optional action, 4 second default, dismiss on swipe.

No `Card` wrapper as a default. Surfaces are formed by background lightness shifts and outlines, with cards reserved for genuinely grouped content (Settings section, About changelog entry). Never nested.

## Per-screen layout

### Timer (hero)

Top to bottom:

1. **Header**, 48 dp tall. App wordmark in `display` weight on the left, connection chip plus overflow on the right. Connection chip uses `success` or `warn` dot plus label in `label` style.
2. **Phase queue**, 24 dp tall. A horizontal row of N small dots (one per session in the current goal). Filled for completed, hollow for upcoming, current dot is the only one with a phase color stroke and slight scale (1.15).
3. **Hero ring block**, 360 dp on phone, 420 dp on tablet. Outer segmented gold goal ring, inner phase ring, centered timer digits in `timer` style with `tnum`, caps phase label below in `caps`. Phase-tinted radial glow behind the ring at 0.18 opacity, fading to bg by 70 percent of radius.
4. **Stats strip**, inline (no card). Three `StatTile`s separated by 1 dp hairlines: today focus time, today session count, current streak. Tapping the strip pushes the Stats screen.
5. **Controls**, anchored 32 dp from bottom. Center is an 80 dp circular FAB in phase color, icon-only play or pause. Skip is a 56 dp ghost icon button at 64 dp from center on the left. Reset is the same on the right, requires long-press to confirm (the icon fills in over the 600 ms hold; release before full = cancel). No labels on icons; long-press tooltip provides them.

### Stats

The current 648-line screen is the biggest UX win. Rebuilt as:

1. **Range toggle**, sticky top. `SegmentedToggle` for Week, Month, All.
2. **Hero line**. Total focus time for selected range in `display` size, delta vs previous period directly below in `bodySmall` with `success` or `warn` color and an arrow glyph. No card.
3. **Heatmap**, 12 weeks for Week range, 26 for Month, 52 for All. GitHub-style grid, coral intensity by minutes focused. Tap a cell pushes History filtered to that day.
4. **Hour-of-day**. Horizontal bar chart across 24 hours, bar height by total minutes at that hour. Coral. Reveals when the user actually focuses. No axis labels under 4 in a row; show 6am, 12pm, 6pm, 12am.
5. **Streak block**. Current and longest streak as two `StatTile`s side by side, gold accent on the current streak number if it equals or beats the longest.
6. **Goal completion ring**, 80 dp, sits next to a 30-day completion percentage. Inline, not a card.

Empty state: if the range has zero sessions, the heatmap, hour chart, and streak block collapse into a single `EmptyState` with a "Start a session" action that returns to the timer tab.

### History

1. Day-grouped list with sticky day headers in `caps` style.
2. Each row: phase chip, start time to end time in `body`, duration in `bodySmall` muted, optional tag chip.
3. Swipe left to delete with undo snackbar (4 second window).
4. Swipe right to edit tag in a bottom sheet.
5. Pull to refresh uses a custom indicator: a small phase-colored ring that fills as the gesture progresses, no system spinner.
6. Empty state on first run: "No sessions yet" with a call to action.

### Settings

1. Sectioned by purpose, each section in a `Card` at `radius.lg` with 16 dp internal padding, 12 dp between cards.
2. Sections: Timer (durations, long-break interval, autostart), Notifications (sound, vibration, do not disturb integration), Theme (system, light, dark, plus optional dynamic color toggle), Desktop client (LAN port, allowed origins, status), Advanced (export history, reset all).
3. Duration controls are sliders snapped to 1 minute, value displayed in `timer` style at 24 sp on the right.
4. Destructive actions in Advanced render in `danger` color and require a confirmation sheet.

### About

1. App icon, 96 dp.
2. App name in `display`, version chip below in `label`.
3. One-line description.
4. Icon row of links (GitHub, license, privacy) using `ghost` buttons.
5. Changelog as an expandable list, latest version expanded by default, older versions collapsed.

## Iconography

Material Symbols Rounded, weight 400, optical size 24. Single family across the app. Filled variants used only for active tab and the FAB icon (play, pause).

## Accessibility

- Every icon-only button has a `contentDescription`.
- Tap targets 48 dp minimum.
- Timer text marked `liveRegion = Polite` so TalkBack announces phase changes without spamming every second.
- Color is never the only signal. Phase changes also announce a caps label, history rows show phase name in text, ring shape encodes progress independently of color.
- Honor system font scale up to 200 percent. The 72 sp timer scales down gracefully and the surrounding chrome reflows to single column.
- Honor reduced motion as specified in Motion section.
- Both themes pass WCAG AA contrast on every text and meaningful non-text element.

## Widget

- 2x2: ring, remaining time, phase label.
- 4x2: ring, remaining time, phase label, play/pause and skip controls.
- Colors match in-app theme. Light variant and dynamic-color variant available on Android 12+.
- Updates throttle to once per minute when running, immediate on phase change.
