# Achievements are a derived, monotonic ledger read from history

[[Profile]] reserved a slot for achievements ([[ADR 0004]] said the stat strip
exists "partly to reserve the slot achievements will occupy"). This is that
feature: a catalog of milestones a member earns by focusing, shown on their own
page in full and on a crewmate's page earned-only.

The whole design turns on one refusal: **nothing about an achievement is stored.**
It is a pure function of the `sessions` table, recomputed on read, exactly like
every other stat (`StatsAggregator` already works this way). No table, no
migration, no second source of truth that could drift from the history it claims
to summarise.

## The eight decisions

1. **Derived, never stored.** `AchievementEvaluator` scores a `StatsSnapshot`.
   Deleting history is the only thing that can take an achievement back.
2. **Monotonic — a ratchet.** Every tile reads a lifetime total or an all-time
   maximum (`lifetime.focusMinutes`, `records.longestStreak`, `records.bestDay`),
   never a *current* value. Breaking today's streak never un-earns "Thirty".
3. **Its own page**, pushed from [[Profile]] — not a block on the Profile. New
   `AchievementsFragment` + `navigation_achievements`.
4. **Number tiles, earned on top / not-earned below.** The badge *is* the number
   (`100h`, `30d`). Flat hairline boxes, earned in full ink and unearned ghosted —
   the ledger idiom of [[ADR 0004]]-A, nothing raised.
5. **Your page shows the whole catalog; a crewmate's shows only what they provably
   earned.** `CrewStatsExtras` fields are nullable and a rebuilt peer snapshot can
   only *understate*, so a false "earned" is impossible but a false "not earned"
   is not. You can always prove someone earned something, never that they didn't —
   so a peer sees no dimmed tiles.
6. **Named titles, fact as subtitle** ("Century" / "100 hours focused").
7. **Profile entry point:** a row showing the furthest rung on each ladder plus
   `n / 16`, tapping through to the page.
8. **Silent notification + a dot on the Profile tab** when a tile is earned —
   specified here, built in the notifications workstream ([[ADR 0003]] neighbours
   it). Detection is a diff of the evaluator across a Work block commit.

**No wire change.** Every input already rides in `CrewSnapshot`/`CrewStatsExtras`
(`allTimeFocusMinutes`, `bestStreak`, `bestDay*`), widened additively long ago.
Nothing here touches `CrewDefaults.PROTOCOL_VERSION`.

## The catalog — 16 tiles

Calibrated against a real, dense history rather than invented to sound
impressive. The strawman that seeded this design set its top rungs (500h
lifetime, 100-day streak, 8h day) where a heavy user had *already been for
months*, so ten of twelve tiles would light up on day one and the rest were pure
calendar-waiting. The catalog below keeps low rungs for a newcomer climbing and
adds real headroom above a heavy user.

| Axis | Tiles | Thresholds |
|---|---|---|
| Focus (lifetime minutes) | First hour · Double figures · Century · The long haul · Four figures · The deep end · Lifer | 1 · 10 · 100 · 500 · 1,000 · 2,000 · 5,000 h |
| Streak (best ever, days) | Three · Seven · Thirty · Hundred days · One eighty · Three sixty-five | 3 · 7 · 30 · 100 · 180 · 365 d |
| Best day (capped) | Deep day · Marathon | 4 · 8 h in one day |
| Milestone | Block one | first Work block |

## Considered options, and what they cost

- **Ship the strawman as-is:** rejected. A trophy case that opens already full is
  not an achievement system; it is a screenshot.
- **A Blocks ladder** (100 / 1,000 Work blocks): rejected. A Work block is ~25 min
  of focus, so a Blocks count double-counts Focus minutes, and [[Focus minutes]]
  is the headline metric — a second ladder measuring the same thing dressed up as
  a different one.
- **Best-week tiles** from the `bestWeek` we already report: rejected. A heavy
  user's best week leaves no healthy headroom — a new rung above it asks for a
  17-hour-a-day week — and for a consistent member it merely restates lifetime
  focus. It would add earned tiles and no chase.

## Consequences

- **The best-day ladder is deliberately capped at 8h.** Cumulative axes are safe
  to extend — reaching 1,000 lifetime hours just takes months. A *single-day*
  ladder only climbs by compressing more grind into one waking period, and the top
  of that ladder is sleep deprivation. The app records that a long day happened; it
  never puts a badge above where you are, because the only way to collect it is a
  worse day.
- **No tile is earned by the calendar alone.** A "one year with Pomo" milestone
  was cut for this reason: it is earned by not uninstalling. The 365-day streak
  covers "a year" and covers it with 365 decisions instead of zero. Every tile is
  earned by an act.
- **Streak tiles are spoken numbers, never "week"/"month".** A 7-day streak is
  seven consecutive days, not a calendar week — the same reason [[CONTEXT.md]]'s
  [[Ranking window]] avoids those words. "Seven", "Thirty", "One eighty" keep the
  copy honest and in one voice.
- **The Profile highlights row shows one tile per ladder**, not a global top-N:
  ranking "500h focus" against "30-day streak" needs an arbitrary common scale, so
  we show the furthest rung reached on each axis — a truer "here's where you
  stand" — and fall back to the first block so a fresh member's row is never empty.
- **The evaluator is pure and Android-free**, unit-tested in
  `AchievementEvaluatorTest` (Robolectric cannot touch anything that writes through
  `CrewStore`; there is nothing to touch here).

## Decision Note 0005-A: The catalog names

Chosen by Snehit on 2026-07-15: **understated English**, extending the strawman's
own voice (Century, The long haul). A thermal voice (Ember, Furnace, Inferno) was
offered as on-brand with the [[#42]] heat identity and rejected — the member has
consistently turned down metaphor-heavy naming, and heat as a *badge vocabulary*
is a costume even when heat as the *core metaphor* is not.
