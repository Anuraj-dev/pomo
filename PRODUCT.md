# PRODUCT.md

register: product

## Users

Primary: knowledge workers and students who use the Pomodoro technique to defend focus time. The phone is on the desk during work — they glance at it constantly. They want to *see time passing*, not be soothed about it.

Secondary: people running the bundled desktop client over LAN, who want their phone to be the authoritative timer.

Mental model the user already has: this is **an instrument**, not a clock. They are not coming to be calmed; they are coming to measure themselves. A timer that hides the seconds feels passive; a timer that shows fractional seconds feels alive. Pomo's job is to feel like a precision tool that is actively counting them down.

## Product purpose

Own a focus session from start to finish as a live performance readout. The phone is the source of truth for state, history, and the LAN API. The UI's job is to make remaining time legible from across a desk, make phase transitions unmistakable, and make every session feel measured.

## Principles

1. **The data is the design.** Numbers are the largest element on every screen. The running timer shows fractional seconds because seeing them tick is the product. Sub-second motion is not flourish — it is the readout doing its job.
2. **Cool monochrome, one signal color.** Backgrounds are cool-tinted slate. Text is cream-white. A single signal-red accent marks live state, peaks, and urgency. No warm decoration. No gold. No pastel.
3. **Performance instrument, not meditation.** References: F1 telemetry, Bloomberg, Linear, Vercel, racing HUDs, aircraft instrument clusters. Anti-references: Headspace, Calm, "mindful" anything, gold-and-cream wellness apps.
4. **High information density.** Don't waste space on whitespace where signal could live. Stats pages should read like a terminal output, not a slide deck.
5. **Snap, don't bounce.** Phase transitions are instant snaps, not soft crossfades. The only continuous motion is the timer's own sub-second tick and the progress bar.
6. **One-handed reach.** Primary controls live in the lower 30 percent. Destructive controls require a second gesture.
7. **Glanceable from a meter away.** Time remaining must be readable without picking the phone up.

## Goals

- Make the running timer feel like it is *measuring you right now*, every fraction of a second.
- Reduce time from app open to running timer to one tap, no setup, no modal.
- Make the current phase unmistakable in under a second of looking.
- Make Stats feel like a telemetry readout of real work, not a dashboard of vanity metrics.
- Make Crew feel like privacy-preserving competitive telemetry: fast rankings
  and shared focus stats without accounts, open public profiles, or a Pomo-owned
  backend.
- Land a real light theme so the app is usable in direct sun — but dark is the canonical experience for this product.

## Success criteria

- A first-time user can start a focus session within 3 seconds of opening the app, with no onboarding.
- A returning user can identify current phase, remaining time, and today's session count in a single glance under 1 second.
- The running timer visibly shows fractional seconds updating; the user perceives the screen as "live."
- Stats screen answers three questions without scrolling: how long have I been doing this, when do I actually focus, am I on streak.
- Crew opens on the last-known leaderboard without waiting for relays. Relay
  refresh happens in the background and the UI exposes freshness explicitly.
- Crew shows its cached leaderboard within 100 ms. Ranking-window changes fit
  within one 16 ms frame for up to 500 members. A healthy relay produces the
  first incremental update within 1 second on normal connectivity; refresh
  settles or exposes partial/offline state within 3 seconds. Crew work never
  delays timer frames or service commands.
- Performance acceptance uses a deterministic 500-member fixture, fake-relay
  timing tests, ranking/window benchmarks, and an Android Macrobenchmark for
  cached Crew rendering. CI does not depend on live public-relay latency.
- Crew refreshes all configured relays concurrently and improves the cached board
  as responses arrive. Relay publication is concurrent and never delays timer
  or service work.
- Relay subscriptions live only while Crew is visible. Pomo performs no periodic
  background Crew pulls; the Room cache provides instant startup and refresh
  occurs when Crew opens.
- This phone publishes after canonical aggregate changes, display-identity
  changes, and Crew creation/join. Opening Crew republishes unchanged data only
  when the last successful publish is more than 24 hours old. Start, pause,
  reset, and skip do not publish unless they commit an aggregate change.
- Valid Snapshot writes persist immediately, but visible leaderboard emissions
  are coalesced to at most one per 100 ms during relay bursts. Reordered rows snap
  to position without bounce or decorative movement.
- Once a cached board exists, synchronization never replaces it with a loading or
  error screen. Crew remains usable and reports `SYNCING`, last-updated age,
  partial relay coverage, or offline state compactly.
- Crew rankings support exactly four comparable windows: Today, rolling 7 days,
  rolling 30 days, and All-time.
- Rolling 7 days means each member's current phone-local date plus the previous
  6 local dates; rolling 30 days means current plus the previous 29. They are not
  elapsed 168-hour or 720-hour windows.
- Today uses each member's phone-local calendar day, consistent with local
  History and Stats. A Snapshot identifies that local date so an old daily total
  cannot carry across midnight.
- Snapshot day-boundary metadata contains the member's local date and numeric UTC
  offset at publication, not a named timezone. This is the accepted minimum
  privacy trade-off for cross-time-zone local-day ranking.
- Crew shares compact daily aggregates plus the aggregate lifetime totals,
  rhythm buckets, and all-time records required by Crew stats and achievements.
  Raw Work block timestamps never leave the member's phone for Crew.
- Members with equal Focus minutes share a rank. Stable row ordering may resolve
  display order but must not resolve the competitive tie.
- Members with zero Focus minutes in the selected window remain visible below
  ranked members with a `—` rank; non-participation is not a placement.
- Crew leads with ranking controls and the leaderboard. Join codes, identity
  editing, Crew switching, creation, and leaving live behind a secondary Manage
  Crew action.
- A Crew has a human-readable name chosen at creation and embedded immutably in
  its Join code. UI uses that name; the protocol Crew id appears only in
  diagnostics. Decentralized mutable renames are not supported.
- Manage Crew presents Share Crew through Android's share sheet and an on-screen
  QR code. Copying the raw Join code remains a secondary compatibility action.
- The canonical shared representation is a versioned
  `pomo://crew/join/v2/<payload>` URI handled by Pomo. Raw-code decoding remains
  supported, and a deep link never saves membership without explicit confirmation.
- Join confirmation shows the Crew name, relay domains, and the membership
  warning: anyone holding the link can read aggregate Crew stats and publish
  self-reported scores.
- Manage Crew supports explicit passphrase-encrypted identity backup and restore,
  preserving the secp256k1 Identity and Crew memberships across reinstall or
  device migration. Identity private keys never appear in Join links or
  unencrypted QR codes.
- Restoring over an existing different Identity is an explicit destructive
  replacement, never a merge. Pomo offers to export the current Identity first,
  then atomically replaces Identity and memberships and rebuilds the Crew read
  model.
- Identity private keys and Crew shared keys are encrypted at rest using an
  Android Keystore-backed wrapping key. Keystore loss requires Recovery-file
  restore; private material is unwrapped only for Crew cryptographic operations
  or explicit export.
- Recovery export requires biometric or device-credential authentication. Normal
  Snapshot signing and publication remain non-interactive.
- Display names are non-unique. When visible members share the same normalized
  Display name, UI appends a short public Identity-key fingerprint for
  disambiguation; otherwise fingerprints remain hidden.
- Display names allow ordinary Unicode and emoji, collapse surrounding/repeated
  whitespace, and are limited to 24 grapheme clusters. Crew names use the same
  rules with a 40-grapheme limit. Blank values, line breaks, control characters,
  and bidirectional overrides are rejected.
- A leaderboard search field appears only above 20 active members. It filters by
  Display name or visible Identity fingerprint while preserving canonical ranks;
  the filtered subset is never re-ranked.
- Snapshot v1 and v2 do not mix. Existing v1 memberships become local read-only
  archives behind a one-time migration notice; active ranking requires creating
  or joining a v2 Crew.
- Crew v2 ships atomically. Protocol, Room projection, concurrent transport,
  migration, joining/sharing, recovery, ranking, and leaderboard UI must all be
  release-ready before v1 is archived in a production build.
- A leaderboard row exposes rank, display name, the selected window's Focus
  minutes, streak, and a compact seven-bar daily trend. Selecting a member opens aggregate
  details: 30-day trend, active days, average per active day, best day, completed
  Work blocks, and comparison with the current member.
- A compact Your Standing strip remains above the leaderboard and shows the
  current member's rank, selected-window Focus minutes, and gap to the next rank.
  The canonical list remains complete; Crew does not use decorative podium cards.
- Your Standing compares distinct ranks: a lower member sees the gap to the next
  distinct rank, a tie shows how many share it, a sole leader sees the lead over
  second, and a zero-window member is explicitly unranked.
- A phone may hide or unhide a member Identity locally. Crew has no kick or ban;
  if a join code is compromised, members create a new Crew.
- A member is marked stale after 7 days without activity and inactive after 30
  days. Inactive members are excluded from active ranks but remain available in
  a collapsed Inactive section with their last aggregate stats.
- Stale and inactive status use the member's last completed Focus Work block,
  not Snapshot publication time or app activity. Snapshot freshness is reported
  separately and cannot keep a member competitively active.
- Each Ranking window includes a compact Crew summary: total Crew Focus minutes,
  members active in that window, and median member Focus minutes. Median is the
  baseline; an outlier-resistant aggregate is preferred over average.
- Rank movement is not shown until the Snapshot protocol provides a reliable
  comparison baseline for every Ranking window. Crew must not infer historical
  rank from whichever relay data happened to be cached on one phone.
- No screen ships without empty, loading, and error states defined.
- App scores at least WCAG AA on every text surface in both themes, and works correctly at 200 percent system font scale.

## Non-goals

- Gamification beyond the derived achievement record, existing streak, daily
  goal, and Crew rankings. Achievements remain a performance ledger; no XP,
  levels, rarity tiers, quests, or coaching mechanics. Profiles remain limited
  to optional identity photos and display names inside private Crews.
- Social networking or account features. Crew is limited to private,
  join-code-based comparison of focus telemetry; the app remains local-first
  and has no login or Pomo-owned social backend.
- An AI coach or recommendation surface.
- Shipping peer sync as a public product before the dormant Android/Chrome
  Replica system is physically validated and explicitly activated. Until then
  the live timer and history stay on the unmigrated phone and extension engines.
- Custom illustration sets or mascots. Visual identity rests on type, color, motion.
- Warm or "cozy" aesthetics. This product is sharp, not soft.

## Tone

Technical, exact, low. The voice of a Bloomberg ticker or a flight computer. Copy is short, monospace where data sits, never cheerful, never coaching. "Focus" beats "Let's focus!". "Break" beats "Time for a well-deserved break." Caps labels are encouraged for instrument-panel framing.

## Anti-references

What this app is not:

- Not a productivity coach (Forest, Focus Keeper marketing copy).
- Not a planner (Notion, Todoist).
- Not a gamified habit tracker (Habitica).
- Not a wellness app (Calm, Headspace palette and motion).
- Not a Dieter Rams nostalgia exercise. Restraint, yes; warm restraint, no.

What it draws from, in spirit:

- The live precision of an F1 timing display and a racing HUD.
- The density and signal-discipline of a Bloomberg terminal.
- The technical sharpness of Linear and Vercel.
- The seriousness of aircraft instrument clusters.
