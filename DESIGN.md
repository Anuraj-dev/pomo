# DESIGN.md

register: product

Design system for the Pomo Android app. Kotlin, Jetpack Compose, Material 3 as substrate. Values here are tokens; `ui/theme/` is the source of truth once shipped.

## Stance

Pomo is an instrument, not a meditation companion. The reference set is F1 timing displays, Bloomberg terminals, Linear, Vercel, racing HUDs, aircraft instrument clusters. The screen should feel like it is *measuring you right now*. The product's job is legible numbers, sharp transitions, and a single signal color that means something.

What that excludes: warm-gold accents, soft pastels, cozy off-whites, "calm-at-rest" reflexes, drop shadows pretending to be paper. Restraint, yes; warm restraint, no.

## Theme

Scene sentence: a knowledge worker glancing at their phone on a desk between Slack and the editor, mid-afternoon under office light, or the same person at 11pm under a single warm bulb running one more block. The phone is held the way you'd hold a stopwatch — not a candle.

Conclusion: dark default. Light theme exists as a real first-class option for direct-sun use, but dark is the canonical surface. Theme is a setting, not a flourish.

## Color

Strategy: **Restrained**. Cool-tinted slate neutrals carry the surface. One signal color — `signal` (a saturated red-orange) — marks live state, peak values, and urgency. Everything else is neutral. No second accent. No gold. No phase-color background washes.

All values in OKLCH. No `#000`, no `#fff`. Neutrals are tinted toward blue (`hue 250`) so the residual feel is cold steel, not warm paper.

### Dark (default, canonical)

| Token | OKLCH | Use |
|---|---|---|
| `bg` | `oklch(0.10 0.008 250)` | App background, cool slate, near-black |
| `surface` | `oklch(0.14 0.010 250)` | Inline panels, sticky headers |
| `surfaceElevated` | `oklch(0.18 0.010 250)` | Sheets, menus |
| `outline` | `oklch(0.26 0.012 250)` | Hairlines, dividers, chart gridlines |
| `outlineStrong` | `oklch(0.40 0.014 250)` | Focus rings, pressed states |
| `onSurface` | `oklch(0.97 0.006 250)` | Primary text, timer digits |
| `onSurfaceMuted` | `oklch(0.72 0.008 250)` | Secondary text, labels |
| `onSurfaceFaint` | `oklch(0.50 0.008 250)` | Fractional-second digits, axis ticks |
| `signal` | `oklch(0.66 0.22 27)` | Live state, peak bars, current-hour mark, danger |
| `signalDim` | `oklch(0.66 0.22 27) / 0.20` | Tinted backgrounds for signal pills |
| `success` | `oklch(0.78 0.14 145)` | Connection ok, streak alive — used sparingly |
| `warn` | `oklch(0.78 0.13 80)` | Offline indicator only — never decorative |

### Light

| Token | OKLCH | Use |
|---|---|---|
| `bg` | `oklch(0.98 0.005 250)` | Cool off-white |
| `surface` | `oklch(0.95 0.006 250)` | Inline panels |
| `surfaceElevated` | `oklch(0.92 0.007 250)` | Sheets |
| `outline` | `oklch(0.82 0.010 250)` | Hairlines |
| `onSurface` | `oklch(0.18 0.010 250)` | Primary text |
| `onSurfaceMuted` | `oklch(0.42 0.010 250)` | Secondary |
| `signal` | `oklch(0.52 0.22 27)` | Denser red for contrast on bright surface |

Phase has no color. The running phase is communicated by the digits and the caps label ("FOCUS" / "BREAK"), not by re-tinting the surface. The signal red is reserved for live state — currently-running, current-hour, peak bar — regardless of phase.

Contrast: every `onSurface*` pair passes WCAG AA. Signal red is tested as foreground on `bg`, `surface`, and `surfaceElevated`.

### Dynamic color

Off. Not offered. The signal red is semantic; remapping it would erase the only color rule the app has.

## Typography

Two families, both bundled.

- **JetBrains Mono** for every digit, every label-as-data, every axis tick. `tnum` enabled so digits do not jitter.
- **Inter** for prose and section headings only.

The visual default leans monospace. If a piece of text *is data*, it's mono. If it's *language*, it's Inter. When in doubt, mono.

Scale (fixed sp):

| Role | Family | Weight | Size | Tracking |
|---|---|---|---|---|
| `timerHero` | JetBrains Mono | 600 | 124 sp | -0.04em |
| `timerMs` | JetBrains Mono | 500 | 44 sp | -0.02em |
| `display` | JetBrains Mono | 600 | 56 sp | -0.02em |
| `headline` | Inter | 600 | 22 sp | -0.005em |
| `title` | Inter | 600 | 17 sp | 0 |
| `body` | Inter | 400 | 15 sp | 0 |
| `bodySmall` | Inter | 400 | 13 sp | 0 |
| `dataLg` | JetBrains Mono | 500 | 18 sp | 0 |
| `data` | JetBrains Mono | 500 | 14 sp | 0 |
| `label` | Inter | 500 | 12 sp | 0 |
| `caps` | Inter | 600 | 11 sp | +0.14em, uppercase |

Hero digits are huge on purpose. They are the product.

## Spacing and shape

4 sp grid. Used: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72.

Layout favors density. Sections sit on the bg directly, separated by hairline `outline`. Cards are the exception, not the default; nested cards are forbidden.

Corner radii:

- `radius.xs` 4 dp — bars, pips, chart elements
- `radius.sm` 8 dp — chips
- `radius.md` 12 dp — buttons
- `radius.lg` 16 dp — sheets, the rare card
- `radius.pill` 999 dp — status pills

No drop shadows. Elevation is implied by surface lightness shifts and outline strength.

## Motion

Snap, don't bounce. The only continuous motion in the app is (a) the running timer's sub-second tick and (b) the progress bar's fill. Everything else is an instant snap or a fast ease-out.

```text
durationXS  =  80 ms   tap feedback, ripple
durationS   = 140 ms   buttons, segmented toggles
durationM   = 220 ms   navigation, sheets
durationL   = 320 ms   phase transition
easeOutQuart = CubicBezier(0.25, 1.0, 0.5, 1.0)
easeOutExpo  = CubicBezier(0.16, 1.0, 0.30, 1.0)
```

No bounce, no elastic, no overshoot. No spring physics as flourish.

State motion:

- **Timer tick**: digits update every animation frame (~16 ms). The ms field rolls continuously; ss field changes once a second. No fade between values — mono digits sit in their cells and just change.
- **Progress bar**: linear fill from 0→1 over the phase duration. No easing; this is a readout, not an animation.
- **Phase transition**: bg unchanged. The caps phase label crossfades in 220 ms. Medium haptic. No goal-bloom, no fireworks.
- **Pause**: digits stay put. A small `[PAUSED]` caps label fades in below in 140 ms. No breathing animation. Paused is paused.
- **Goal reached**: the last pip in the launch row fills with signal red and a single 80 ms haptic confirm. No bloom, no sweep.
- **Tab navigation**: shared X axis, 220 ms, ease-out-quart.

Reduced motion: every transition collapses to 0 ms crossfade. The timer tick still updates digits (the tick is the product, not decoration).

Haptics: light tick on start/pause/tab; medium impact on phase complete; `CONFIRM` on goal. No haptics during scroll.

## Components

In `ui/components/`. Every interactive component defines default, pressed, focused, disabled, loading.

- `TimerReadout` — the hero. Huge mono `MM:SS` digits with `.mmm` fractional field beside them at ~60% opacity and ~35% scale. Caps phase label above. No ring, no glow, no card.
- `LinearProgress` — flat 4 dp horizontal bar with signal-red fill on outline track. Replaces the dual ring entirely.
- `LaunchPips` — N small 6 dp squares (one per goal session). Filled `onSurfaceMuted` for completed, `outline` for upcoming, `signal` for the active one.
- `Bar` — vertical/horizontal data bar with `radius.xs`, signal red for peak, `onSurfaceMuted` for everything else.
- `BarChart24` — 24-bar horizontal hour-of-day chart. X labels at 6/12/18 only. Peak hour painted signal red.
- `BarChart7` — 7-bar Mon..Sun day-of-week chart. Same coloring rule.
- `Heatmap` — 12-week grid, 4 intensity steps from `outline` to `onSurface`. No signal red in the heatmap; intensity is monochrome.
- `StatTile` — value in `dataLg`, label in `caps`. Sits on bg with hairline divider; never in a card.
- `PomoButton` — three variants. `primary` (signal-red fill, only one per screen), `tonal` (onSurface at 0.10), `ghost` (icon or text only). 48 dp min target. Haptic on press.
- `PhaseChip` — pill with mono label, `outline` border, no fill. Phase identified by text.
- `SegmentedToggle` — for time-range selection.
- `SectionHeader` — caps label, hairline above, 8 dp top padding.
- `EmptyState` — caps headline, body, optional ghost action. No illustration.
- `Sheet` — bottom sheet, drag handle in `outline`.
- `Snackbar` — single line, optional ghost action, 4 s default.

No `Card` as default. Surfaces are formed by hairlines.

## Per-screen layout

### Timer (hero)

The screen exists to make remaining time readable from a meter away and to make the readout feel alive.

Top to bottom:

1. **Header bar**, 44 dp. App wordmark left in `caps`. Right side: connection dot (`success`/`warn`) + overflow icon. No "Phone primary" badge — this is the phone.
2. **Hero block**, occupies the upper 55% of the screen. Centered:
   - Caps phase label (`FOCUS` or `BREAK`), 11 sp, `onSurfaceMuted`, 16 dp above digits.
   - Hero digits `MM:SS` in `timerHero` (124 sp), `onSurface`, optical-center aligned.
   - Beside the seconds digit (baseline-aligned to its lower third), the millisecond field `.mmm` in `timerMs` (44 sp), `onSurfaceFaint`. Updates every frame.
   - Below digits, a thin signal-red live dot (4 dp) with `LIVE` caps label when running; `[PAUSED]` caps label when paused.
3. **Progress bar**, 4 dp tall, full bleed with 24 dp horizontal padding. Fills linearly over the phase.
4. **Launch pips**, centered horizontal row. One pip per session in the daily goal. Current pip is signal red.
5. **Stats strip**, inline. Three `StatTile`s on bg separated by hairlines: today focus minutes, today sessions, current streak. Tapping pushes Stats.
6. **Controls**, anchored 32 dp from bottom:
   - Center: 72 dp signal-red `primary` button, icon-only play/pause.
   - Left, 56 dp ghost icon: reset (long-press to confirm; icon fills over 600 ms hold).
   - Right, 56 dp ghost icon: skip.
   - No labels; long-press tooltip.

Phase color is text, not surface. The bg never changes hue between focus and break.

### Stats

Built to answer three questions without scrolling: how long have I been doing this, when do I actually focus, am I on a streak.

1. **Lifetime hero**, top of screen. Single huge mono total ("142h 17m") in `display`, caps label `LIFETIME` above, subline "324 sessions · 47 days with Pomo" in `data muted` below. No card.
2. **Hour-of-day** — `BarChart24`. Headline: "When you focus". Caption: "Peak: 10–11 AM · 42% of work happens 9 AM – 1 PM". Peak hour bar in signal red, rest in `onSurfaceMuted`.
3. **Day-of-week** — `BarChart7`. Mon..Sun. Headline: "Which days you show up". Best day in signal red.
4. **12-week heatmap** — monochrome grid. Headline: "Last 12 weeks". Legend bar below: faint → strong.
5. **Records list** — three rows on bg, hairlines between:
   - Longest streak — `42 days` · `Mar 4 – Apr 15`
   - Best day — `8 sessions` · `Tue Apr 23`
   - Best week — `34 sessions` · `Apr 22 – Apr 28`
6. **Footer** — `Since Apr 3, 2025` in `data muted`, right-aligned. Export CSV as a ghost link.

Empty state: if no sessions, all of the above collapse into a single centered caps line `NO SESSIONS YET` with a ghost "Start a session" action returning to Timer.

### Crew

Crew is a leaderboard first, not an administration form.

1. **Header** — the human-readable Crew name plus a compact freshness readout and
   a secondary Manage Crew action. Freshness uses `SYNCING`, `UPDATED 2m AGO`,
   `PARTIAL · 2/3 RELAYS`, or `OFFLINE · UPDATED 3h AGO`. Once cached rows exist,
   refresh never replaces them with a full-screen loading or error state.
2. **Ranking window** — segmented control for Today, 7 days, 30 days, and
   All-time.
3. **Crew summary** — three inline `StatTile`s for total Crew Focus minutes,
   members active in the selected window, and median member Focus minutes.
4. **Your standing** — compact inline strip with the current member's rank,
   selected-window Focus minutes, and competitive context. Show gap to the next
   distinct rank, `TIED WITH N`, lead over second, or `UNRANKED` as applicable.
   Never show a misleading zero-minute gap. No podium treatment.
5. **Leaderboard** — dense ranked rows immediately below the standing strip.
   Equal Focus-minute totals share a rank. The current member is marked with the
   signal color without turning every row into a card. Each row contains rank,
   display name, selected-window Focus minutes, streak, and a compact 7-day
   trend rendered as seven daily bars, never an interpolated line.
   Seven-day-silent members are visibly stale. Members inactive for 30
   days leave active ranking and appear in a collapsed `INACTIVE` section rather
   than disappearing. Zero-window members follow ranked members and display `—`
   instead of a numeric rank. Relay bursts coalesce into at most one visible
   update per 100 ms; rank changes snap without bounce or reorder animation.
   Duplicate normalized Display names gain a short public Identity fingerprint,
   such as `Asha · 7F2C`; unique names do not show protocol metadata.
   Above 20 active members, a compact search field filters Display name or visible
   fingerprint without changing the stored rank numbers.
   The board is a keyed virtualized lazy list; it must not compose every member
   inside a vertically scrolling `Column`.
6. **Management** — join code, display name, Crew switching, creation, joining,
   and leaving live in a sheet opened from Manage Crew. They never precede the
   leaderboard in the main scroll path. `Share Crew` opens Android sharing and
   exposes a scannable QR code; raw Join-code copy is secondary.
7. **Member details** — tapping a row opens a bottom sheet with the 30-day trend,
   active days, average per active day, best day, completed Work blocks, and a
   comparison with the current member. No raw Work block timestamps appear. A
   secondary action hides or unhides that Identity on this phone only.

Join links open a confirmation sheet showing Crew name, relay domains, and the
shared-link/honor-system warning before the primary `JOIN` action becomes
available. Deep links never join silently.

### History

1. Day-grouped list, sticky day header in `caps`.
2. Row: phase chip · `HH:MM → HH:MM` in `data` · duration in `data muted` · optional tag chip.
3. Swipe left to delete with 4 s undo snackbar.
4. Swipe right to edit tag.
5. Empty: caps "NO SESSIONS YET".

### Settings

1. Sectioned with `SectionHeader` (no cards). Sections: Timer, Notifications, Theme, Desktop client, Advanced.
2. Duration controls: stepper buttons (− / value / +) with the value in `dataLg`. No slider.
3. Theme: System / Light / Dark as a `SegmentedToggle`.
4. Destructive actions in Advanced render in `signal` and require a confirmation sheet.

### About

1. App icon 80 dp.
2. App name in `display`, version chip in `caps`.
3. One-line description in `body`.
4. Ghost-icon row of links.
5. Changelog list, latest expanded.

## Iconography

Material Symbols Rounded, weight 400, optical size 24. Filled variant only for the primary play/pause icon. Everything else is outlined.

## Accessibility

- Every icon-only button has `contentDescription`.
- 48 dp min tap target.
- Timer text is `liveRegion = Polite`. TalkBack reads `MM:SS` only — not the ms field.
- Signal red is never the only cue. Live state also reads `LIVE` in text; peak bar is also tallest; current pip is also positioned.
- System font scale honored to 200%. Hero digits scale down; ms field hides at >150%.
- Reduced motion honored as specified.

## Widget

- 2×2: digits (no ms), phase label.
- 4×2: digits (no ms), phase label, progress bar, play/pause + skip.
- Updates throttle to once a minute when running; immediate on phase change.
- Widget never shows the ms field — battery and update cadence don't justify it off-screen.
