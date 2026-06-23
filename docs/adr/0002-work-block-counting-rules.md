---
status: accepted
---

# Work-block counting rules: time-honest minutes, earned blocks

## Context

A Work block only counted if its timer ran to the scheduled end. `OfflineTimer.skip()`
recorded nothing, so partial focus time on a skipped block was discarded everywhere
(Focus minutes, count, Stats, History, Crew). The `completed: Boolean` on a session was
doing double duty: in `HistoryDao.insertSessionWithDayStats` it gated **both** the block
count **and** `workMinutes`, and `StatsAggregator` filtered `type==work && completed` — so
there was no way to express "real focus time that wasn't a finished block."

## Decision

Split the two currencies that `completed` conflated:

- **Focus minutes are time-honest.** They count actual focus-phase time, including the
  partial time of a block ended by **Skip**, and excluding any block ended by **Reset**.
  Stats, History, and Crew ranking inherit this because they run off Focus minutes.
- **The block count is earned.** Only a block that runs to its scheduled end increments
  the count (cadence / Daily goal / long-break trigger). A completed block counts as
  **exactly 1 regardless of length** — add-time grows its minutes, never its block value.

Concrete rules:

1. **Skip on a work phase** records a partial `Session(type=work, completed=false)` with
   `duration = elapsed focus seconds (= state.duration − state.remaining)`, **only if
   elapsed ≥ 60s**. Below 60s, Skip records nothing. Recorded partials round elapsed
   seconds **up** to whole minutes, consistent with existing segment rounding.
2. **Reset** and all **implicit abandonment** (app closed mid-block, paused-and-left,
   process death) record nothing.
3. **Crew snapshot publishes immediately** after a recorded partial Skip
   (`publishCrewSnapshot("partial work block")`), mirroring the completion path.
4. **History** shows partial blocks with a subtle **neutral** marker (outline/muted
   tokens — never signal-red). Aggregate Stats get no per-block partial styling; they
   already encode the distinction numerically (minutes include partials, count excludes).
5. **Midnight:** a completed block is **filed under the day it started**; its minutes are
   split by actual calendar day. A **running block crosses midnight intact** — reconcile
   must not wipe a running block on a date change. A skipped crossing block splits its
   minutes across days with **0 blocks on either** day.

## Considered alternatives

- **Keep the binary rule** (skip = nothing counts). Simpler, but it discards genuine focus
  effort — the behavior this task exists to fix.
- **Scale the count by length** (a 75-min block ≈ 3 blocks). Rejected: the count drives
  cadence (long-break trigger, launch pips), which is about focus→break cycles, not
  minutes; duration is already expressed by Focus minutes.
- **File a crossing block under the day it ends** (current code: count on the last
  segment). Rejected in favor of start-day filing — blocks belong to when you began them.
  Accepted wrinkle: a block started at 11:58pm files under the old day even if most of its
  minutes fell after midnight (minutes still split honestly).

## Consequences / implementation pointers

- `completed` now means "counts as a discrete block," not "counts at all." `workMinutes`
  in `HistoryDao.insertSessionWithDayStats` and the `StatsAggregator` focus-minute filters
  must include `type==work` **regardless of** `completed`; the count stays gated on it.
- `insertSessionWithDayStats` must attribute the completed `+1` to the **first** segment
  (start day), not `segments.lastIndex`.
- `OfflineTimer.skip()` must record a partial session (with the 60s floor) before advancing
  phase; `reconcileStateWithHistory` must stop resetting a *running* block at midnight.
