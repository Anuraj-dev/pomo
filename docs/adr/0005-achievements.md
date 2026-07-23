# Achievements are a derived performance ledger

Achievements record evidence of Focus work. They are not XP, levels, quests, or
a coaching system. The member's canonical Room history remains the only source
of truth: `AchievementEvaluator` scores a `StatsSnapshot` on read, and no
achievement table or mutable unlock flag exists.

Deleting history can remove a record because the evidence no longer exists.
Otherwise every criterion reads a lifetime total or all-time maximum, so earned
records are monotonic.

## Decisions

1. **Performance record, not game progression.** Achievements document work that
   happened. They do not prescribe what the member should do next.
2. **Track-relative hierarchy.** A later Focus rung supersedes an earlier Focus
   rung, but Focus, Active days, Streak, and Best day are complementary measures.
   There is no global rarity, tier, score, or bronze/silver/gold vocabulary.
3. **Complete, visible catalog.** The owner's page exposes every threshold. The
   highest earned rung is the track record, the immediate upcoming rung is Next,
   and later rungs remain visible in faint ink. There are no secret records or
   lock icons.
4. **Track panels, not a card wall.** Entry appears first, followed by compact
   panels for Focus volume, Active days, Longest streak, and Best day. Numeric
   badges remain the strongest visual element.
5. **Mathematically honest progress.** Focus and Active days are cumulative and
   can show `current / next`. Streak and Best day are all-time maxima: they show
   Best and Next record instead of pretending that separate attempts add up.
   Current streak is shown separately from longest streak.
6. **One standalone landmark.** Block one records the first Work block that
   contributes Focus time, including a partial block ended with Skip. Reset
   records nothing. Feature use, settings, tags, time of day, and Crew membership
   do not earn achievements.
7. **Owner ledger, peer records.** Profile and Crew show only the highest earned
   record per track, falling back to Block one for a fresh member. A peer never
   sees an unearned state because an older or partial snapshot can understate
   their history.
8. **Quiet notification coalescing.** A history commit produces at most one low-
   importance notification. Simultaneous thresholds are grouped as records
   updated. The Profile dot remains one bit regardless of count. Catalog rungs
   already satisfied when a new build starts are established as the baseline and
   appear silently.

## Catalog: 29 records

| Track | Titles | Thresholds |
|---|---|---|
| Entry | Block one | first recorded Work block |
| Focus volume | First hour · Double figures · Fifty · Century · Two fifty · The long haul · Four figures · The deep end · Lifer | 1 · 10 · 50 · 100 · 250 · 500 · 1,000 · 2,000 · 5,000 h |
| Active days | Ten · Thirty · Fifty · One hundred · Two fifty · Five hundred · One thousand | 10 · 30 · 50 · 100 · 250 · 500 · 1,000 active days |
| Longest streak | Three · Seven · Fourteen · Thirty · Sixty · One hundred · One eighty · Three sixty-five | 3 · 7 · 14 · 30 · 60 · 100 · 180 · 365 d |
| Best day | Two-hour day · Deep day · Long day · Marathon | 2 · 4 · 6 · 8 h in one day |

An **active day** is a local calendar day containing at least one completed Work
block. Partial Focus time remains valid for the Focus-volume track but does not
establish Active-day or Streak consistency.

## Boundaries

- Best day stops at 8h. A higher rung would reward compressing more work into one
  waking period.
- Longest streak stops at 365d. Active days carries sustainable long-term
  consistency without requiring the member to avoid every rest day indefinitely.
- No record is earned by elapsed tenure alone. Keeping the app installed is not
  an accomplishment.
- Completed Work-block totals are not a separate ladder because timer duration is
  configurable and the count largely duplicates Focus minutes.
- Best week is not a ladder because it duplicates volume and creates unhealthy
  headroom pressure.
- Daily-goal hits are not historical achievements because goal configuration can
  change and prior goals are not stored with each day.

## Crew compatibility

Focus total, longest streak, and Best day already ride in `CrewSnapshot` and its
optional `CrewStatsExtras`. `allTimeActiveDays` is added to those optional JSON
extras. Gson ignores unknown keys, so older clients remain compatible and
`CrewDefaults.PROTOCOL_VERSION` does not change. Older peer snapshots may
understate Active-day records; earned-only track summaries remain truthful.

## Naming

The badge is the number; the title adds restrained spoken English; the fact is
literal. Names avoid praise, identity judgments, game rarity, and calendar words
that do not match the measured boundary. This continues the understated voice
chosen in Decision Note 0005-A.
