# Pomo Extension — Review Findings & Task Checklist

Source of truth: status review of 2026-08-06. Each item is a fix. After implementation, verify each by reading the final code and (where applicable) the relevant test files. CI runs lint/tests; local runs are skipped per AGENTS.md.

Legend: [H] High, [M] Medium, [L] Low.

---

## A. Timer engine (`src/engine/timer.ts`)

- [ ] A1 [H] `snapshot()` can return an expired timer as `{ status: "running", remaining: 0 }`. Reconcile (tick) before exposing state, or expose a helper the SW always calls before reading.
- [ ] A2 [H] `extend()` accepts negative/fractional/NaN/Infinity seconds. Validate to a finite positive number (or clamp).
- [ ] A3 [H] `extend()` can resurrect an already-expired timer because it never ticks first. Tick before extending; only extend if still running.
- [ ] A4 [M] `restore()` trusts all saved fields (only `version` is checked). Add runtime sanitization: enum checks for status/phase, finite numbers, non-negative durations, valid start time.
- [ ] A5 [M] `skip()` hard-codes `short` break after work; never selects long break. Document or route both transitions through one cadence function (product decision — leave behavior, document).
- [ ] A6 [M] `longBreakAfter()` port assumed valid positive int. Normalize/validate injected value.
- [ ] A7 [L] `lastAction` is updated every tick (misleading name). Rename to `lastUpdatedTime` or only update on commands/completions.
- [ ] A8 [L] Constructor reads clock multiple times; date/lastAction can straddle midnight. Derive date from captured `now`.
- [ ] A9 [L] `nextPhase` persisted but never consumed by restore. Remove or reconcile.

## B. Blocks / date logic / settings / stats (`src/engine/blocks.ts`, `dateLogic.ts`, `settings.ts`, `stats.ts`)

- [ ] B1 [M] `OffsetMinutes` callback form is never actually invoked (falls back to host-local). Fix: genuinely use callback, or rename type to signal host-local sentinel.
- [ ] B2 [M] `splitBlockByCalendarDay()` silently accepts non-finite/negative durations. Reject them.
- [ ] B3 [M] Rounding can create zero-duration segments that still persist (metadata lives on segment 0). Omit zero-length segments or preserve exact seconds.
- [ ] B4 [M] Earned credit always attributes to the first (start) date. Document policy explicitly in contract.
- [ ] B5 [L] `deltasForBlock()` re-splits a block independently from SW — return both segments and deltas from one function.
- [ ] B6 [M] `dateStringOf`/`epochOfDate` don't validate date strings; `2026-99-99` passes. Enforce `^\d{4}-\d{2}-\d{2}$` and verify round-trip.
- [ ] B7 [M] `settings.ts`: fractional value in (0,1) floors to 0 (e.g. workMinutes=0.5 -> 0, longBreakAfter=0.5 -> 0 -> modulo-by-zero in timer). Floor first, then require >= 1.
- [ ] B8 [M] Settings accept arbitrarily large values. Add product-level upper bounds.
- [ ] B9 [L] `longBreakAfter` validated by `positiveMinutes` (wrong name/unit). Use a `positiveCount`.
- [ ] B10 [L] Tags unbounded length. Enforce a max (and drop control chars).
- [ ] B11 [M] `stats.ts`: hourly/weekday buckets round each session up separately (`Math.ceil`). Accumulate seconds, round once.
- [ ] B12 [M] `rhythmBuckets()` doesn't validate `count` (0 -> NaN index, negative -> throw). Validate.
- [ ] B13 [M] `startDay` not validated (can be negative/fractional/out of range). Validate 0..6 integer.
- [ ] B14 [M] Historical timezone bucketing uses one fixed offset (DST wrong). Accept offset-at-time function or use local date ops.
- [ ] B15 [L] `bestWeekOf()`/`lastNDays()`/date parsing edge cases (tie-break determinism, negative n, unchecked date parse). Tighten.

## C. Background service worker (`src/background/sw.ts`)

- [ ] C1 [H] `pomo:query` does not tick the engine first; can return expired-but-running state. Reconcile then snapshot.
- [ ] C2 [H] `extend` handler does not tick first; same resurrection risk as A3.
- [ ] C3 [H] `earnedByDate` in-memory counts updated before DB write succeeds; no rollback on failure. Update cache only after durable write (or reconcile on failure).
- [ ] C4 [H] `sync()` (storage writes) not serialized; out-of-order writes can persist stale state. Serialize/coalesce.
- [ ] C5 [H] Settings writes + sync are fire-and-forget; caller gets success before durability. Await persistence before returning ok.
- [ ] C6 [M] History commit errors partly swallowed; `pendingWrite` only reflects last op. Keep observable error state / reconcile cache on failure.
- [ ] C7 [M] Cross-midnight session persistence not atomic across dates. Add DAO op that persists all segments+deltas in one transaction.
- [ ] C8 [M] Duplicate per-date delta application possible if >1 segment per date. Enforce one-segment-per-date invariant or dedupe.
- [ ] C9 [M] Settings change doesn't re-arm stopped timer (old duration displayed until toggle). Add engine method to re-arm stopped phases.
- [ ] C10 [M] Notification errors ignored; `soundEnabled` actually gates notifications (name mismatch). Handle rejection, document/rename semantics.
- [ ] C11 [M] Alarms/startup promise chains lack .catch(). Add top-level error logging.
- [ ] C12 [M] Only today + restored start date loaded into `earnedByDate` cache; other dates may query as 0. Preload or make cache non-authoritative.
- [ ] C13 [M] `pomo:stats` can race pending history writes. Await history queue before DB-backed reads.
- [ ] C14 [L] `pomo:query` state not persisted/badge-updated (can lag returned state).
- [ ] C15 [L] Repeated clock reads can cross time/date boundaries; derive offset from captured epoch.
- [ ] C16 [L] History sort comparator never returns 0 (`a.date < b.date ? 1 : -1`). Use `localeCompare`.

## D. Database layer (`src/db/dao.ts`, `schema.ts`, `types.ts`)

- [ ] D1 [H] `insertSessionWithDayStats()` double-counts daily stats when a session with an existing `start` key is written again (put replaces row, delta always added). Make idempotent (use add() + reject duplicates, or subtract prior contribution).
- [ ] D2 [M] `mergeBackup()` silently discards conflicting imported sessions (same `start` wins silently, first-wins for duplicates). Surface conflicts; reject duplicate keys.
- [ ] D3 [M] Daily-stat merge takes max per field independently → impossible hybrid rows. Document policy; consider session-derived canonical totals.
- [ ] D4 [M] `mergeBackup()` rewrites every session/day-stat row + fresh lastUpdated. Only write changed rows; preserve lastUpdated.
- [ ] D5 [M] `upsertLatest()` erases valid aggregates when input list is incomplete (delete-all-then-insert). Guard truncated data.
- [ ] D6 [M] `upsertLatest()` acceptance relies only on publisher timestamp (clock-skew / far-future pinning). Harden acceptance.
- [ ] D7 [M] Relay errors can't be explicitly cleared (`null` = preserve). Add distinct clear semantics (undefined vs null).
- [ ] D8 [M] Schema: destructive `settings` store deletion on every upgrade to v2 (not version-gated). Gate on oldVersion.
- [ ] D9 [M] Schema: no version-by-version migrations; existing stores not repaired (missing indexes). Add versioned migration + index repair.
- [ ] D10 [M] Schema: no `onversionchange` handling; blocked opens. Add close handler.
- [ ] D11 [M] DAO boundary lacks domain validation (negative deltas, mismatched crew keys). Add guards.
- [ ] D12 [M] `tx()` helper needs tests (rollback on failure, abort semantics).

## E. Backup/restore (`src/shared/backup.ts`, restore path in `sw.ts`)

- [ ] E1 [H] Backup JSON is unencrypted/unsigned and contains identity private key + all crew keys plaintext. Encrypt + authenticate (AEAD w/ passphrase) and/or warn clearly. (Product decision — at minimum document + warn.)
- [ ] E2 [H] `profileAvatarBase64` declared but never exported (always null). Export real avatar or drop field.
- [ ] E3 [M] Date validation is format-only (`2026-99-99` passes). Use real calendar-date validation.
- [ ] E4 [M] No bounds on offsets/durations/timestamps/counts; `numberValue` doesn't require safe integers. Add bounds + `Number.isSafeInteger`.
- [ ] E5 [M] Active Crew ID not validated against memberships/format. Validate.
- [ ] E6 [M] Snapshot names/avatars weakly validated (no base64/MIME/size bounds). Tighten.
- [ ] E7 [M] Relay strings not validated as relay URLs (join-code check exists, but duplicates/schemes/casing uncanonicalized). Canonicalize.
- [ ] E8 [M] Duplicate records (sessions, dates, memberships, snapshots, aggregates, hidden members) accepted — restore becomes order-dependent. Reject duplicates.
- [ ] E9 [M] `encodePortableBackup()` doesn't validate output or enforce size. Validate + enforce size on encode.
- [ ] E10 [M] Original membership join time lost (regenerated at restore). Preserve field.
- [ ] E11 [M] Forward-compat rigid (exact version 1 only) — acceptable, but no migration layer. Document.
- [ ] E12 [M] Restore is not atomic across IndexedDB + chrome.storage (partial restore risk). Add staging/import marker or transactional commit.
- [ ] E13 [M] Export is not a consistent snapshot (multiple reads can race writes). Snapshot reads or document inconsistency window.
- [ ] E14 [M] Hidden-member `hiddenAtEpochSeconds` rewritten to export time. Export real value.
- [ ] E15 [M] Settings omitted from backup. Include settings or document "history + Crew backup only".
- [ ] E16 [L] Relay diagnostic state (crewRelayState) omitted. Explicit design decision.

## F. Crew system (`src/crew/*`)

- [ ] F1 [H] `crewService.refreshMembership()` — malformed single event can abort whole refresh (verifyEvent can throw; not caught). Make verify exception-safe / catch per event.
- [ ] F2 [H] `transport.ts` binary messages parsed via `String(raw)` on Uint8Array → garbage. Use TextDecoder; handle ArrayBuffer/Blob.
- [ ] F3 [H] `transport.ts` relay URL validation bypassed when `socketFactory` supplied. Validate before factory.
- [ ] F4 [H] `nostrEvent.verifyEvent()` not safe over untrusted input (`evt.content` may not be string, `kind` not validated). Make total over `unknown`.
- [ ] F5 [M] `transport.ts` global event limit race-prone; dedup before verification allows ID-suppression attack. Dedup after verification or retain (id, serialized) pairs.
- [ ] F6 [M] `nostrEvent` no tag-count/length limits; arbitrarily old events accepted (no replay lower bound). Add bounds.
- [ ] F7 [M] `nostrEvent` crew-tag matching permissive (any matching d tag). Require canonical single tag.
- [ ] F8 [M] `snapshot.ts` numeric fields accept fractional values where integers expected (blocks, streaks, epochs). Per-field validators.
- [ ] F9 [M] `snapshot.ts` `localDate` format-only (not real date). Real date validation.
- [ ] F10 [M] `snapshot.ts` extended-stats date fields not validated; `{}` passes `validateStats` but cast to fully-required `CrewStatsExtras`. Require fields or define partial type.
- [ ] F11 [M] `snapshot.ts` ciphertext limit counts base64url chars, not bytes. Decode then check bytes.
- [ ] F12 [M] `snapshot.ts` sender doesn't enforce plaintext/envelope limits or validate before encrypt. Enforce.
- [ ] F13 [M] `ownSnapshot.ts` builds snapshot without runtime validation; invalid local data published then rejected by peers. Validate before encrypt/publish.
- [ ] F14 [M] `leaderboard.ts` never-focused members marked active forever (zero lastFocusedAt). Separate neverFocused state.
- [ ] F15 [M] `leaderboard.ts` future lastFocusedAt → perpetually active. Bound against publication time.
- [ ] F16 [M] `leaderboard.ts` total includes inactive while ranked/median exclude them. Define/populate consistently.
- [ ] F17 [M] `joinCode.ts` private-host rejection incomplete; duplicate relay detection textual. Canonicalize + harden.
- [ ] F18 [M] `keyring.ts` encodeRecovery doesn't cap/dedupe relays (can emit data its own decoder rejects). Align with decodePayload.
- [ ] F19 [M] `keyring.ts` iteration count not integer-validated. Require Number.isInteger.
- [ ] F20 [L] `identity.ts` fingerprint only 32 bits; collisions plausible. Lengthen or document non-authenticating.
- [ ] F21 [L] `crewService.loadCrewBoard()` N+1 daily queries. Batch query.
- [ ] F22 [L] `crewService` memberCount includes hidden members. Fix or document.
- [ ] F23 [L] `validation.ts` manual Cf/Cc blacklist fragile; confusables allowed. Use Unicode property escapes; document confusable risk.

## G. Shared utils (`src/shared/*`)

- [ ] G1 [M] `badge.ts` NaN → "NaN:NaN" badge. Validate finite.
- [ ] G2 [M] `bytes.ts` empty base64url rejected (`+` regex). Use `*`.
- [ ] G3 [M] `bytes.ts` TextDecoder non-fatal (U+FFFD) in crypto/serialization paths. Use fatal for binary protocol paths.
- [ ] G4 [M] `format.ts` NaN/Infinity render garbage. Clamp/reject non-finite.
- [ ] G5 [M] `messages.ts` settings guard only checks objectness; command validation permits negative/fractional seconds. Add per-command validation + settings field checks.
- [ ] G6 [M] `messages.ts` empty/whitespace strings pass string guards. Trim/length checks.
- [ ] G7 [L] `messages.ts` `POMO_REQUEST_TYPES` can drift from union. Consolidate or generate.
- [ ] G8 [M] `instrument.ts` ticker can't be stopped; runs at 20 FPS even paused. Return cleanup; slow/stop when not running.
- [ ] G9 [M] `instrument.ts` stats values trusted without validation; concurrent refreshStats can race. Validate + sequence.
- [ ] G10 [M] `surface.ts` initial query can race storage updates (stale overwrite). Sequence/version checks.
- [ ] G11 [M] `surface.ts` theme: flash on load, no change subscription, errors unhandled, values trusted. Apply pre-flash, subscribe, catch, validate.
- [ ] G12 [M] `surface.ts` request() always resolves even on transport failure; no lastError read. Improve error contract.

## H. UI surfaces (`src/surfaces/*`)

- [ ] H1 [H] `crew/main.ts` board cache only invalidated on crew change; window change shows old window's data labeled as new. Include window in cache key or clear on window change.
- [ ] H2 [H] `crew/main.ts` invite review/confirm can refer to different values (editable fields re-read on confirm). Capture reviewed payload or disable confirm on field change.
- [ ] H3 [M] `crew/main.ts` focus trap includes controls under hidden ancestors. Ancestor-aware visibility check.
- [ ] H4 [M] `crew/main.ts` selecting crew mutates local state before persistence succeeds. Commit after success / rollback.
- [ ] H5 [M] `crew/main.ts` hide-member ignores unsuccessful response. Check response.ok.
- [ ] H6 [M] `crew/main.ts` "days active" counts zero-minute days. Use `> 0`.
- [ ] H7 [M] `crew/main.ts` detached async modal ops can modify wrong dialog / global showError. Generation/token guard.
- [ ] H8 [M] `crew/main.ts` newly joined/created crew assumed to be last response entry. Return explicit ID.
- [ ] H9 [M] `crew/main.ts` create/join select result ignored. Check response.ok.
- [ ] H10 [M] `crew/main.ts` failed setting save leaves optimistic control state. Restore on failure.
- [ ] H11 [M] `crew/main.ts` loadCrews error → "no crews" UI. Preserve prior data + show error.
- [ ] H12 [M] `crew/main.ts` freshness relies on exact timestamp equality for success. Dedicated flag.
- [ ] H13 [M] `newtab/main.ts` settings response can override user's later tab selection. Only apply default before user navigates.
- [ ] H14 [M] `newtab/main.ts` history rendering assumes pre-grouped/sorted sessions. Group with map/sort.
- [ ] H15 [M] `newtab/main.ts` async tab loads can race (older overwrites newer). Sequence.
- [ ] H16 [M] `newtab/main.ts` settings form no client validation (NaN/0/fractional pass). Validate with same rules.
- [ ] H17 [M] `instrument.ts`/popup/sidepanel duplicate bootstrap; non-null DOM assertions crash on drift. Shared helper.
- [ ] H18 [L] `newtab/main.ts` spacebar toggles timer even from focused buttons. Exclude interactive elements.
- [ ] H19 [L] `newtab/main.ts` no hash-change listener. Add it.
- [ ] H20 [L] `crew/main.ts` formatAge future timestamps → "just now". Clamp.
- [ ] H21 [L] `crew/main.ts` rename sends untrimmed text. Trim.

## I. Build (`scripts/build.ts`)

- [ ] I1 [M] Watch rebuilds can overlap (rmSync dist + concurrent builds corrupt output). Debounce + serialize.
- [ ] I2 [M] Every rebuild deletes dist (transient missing extension in watch). Build to temp + atomic swap.
- [ ] I3 [L] Watch scope misses manifest.json, gen-icons.ts, build config. Expand watch scope.
- [ ] I4 [L] Single failed watch build exits watcher. Continue on error in watch mode.

## J. Tests (`tests/*`)

- [ ] J1 [H] No test for `mergeBackup()`. Add coverage (disjoint, conflicts, duplicates, hybrid totals, lastUpdated preservation).
- [ ] J2 [H] No idempotency test for `insertSessionWithDayStats()` (would expose D1). Add.
- [ ] J3 [M] Backup tests shallow. Add: size limit, invalid dates, bounds, safe-integers, duplicates, join-code mismatches, activeCrewId, avatar/relay validation, encoder output validity.
- [ ] J4 [M] No schema migration tests (v1→v2, settings store, missing indexes). Add.
- [ ] J5 [M] No tx() rollback tests. Add.
- [ ] J6 [M] Relay-state test codifies stale-error retention (lines 264-274 db.test.ts). Revisit per D7.

---

## Verification notes (how to confirm after implementation)

- Run `bun run typecheck` (narrowest check; full lint/tests deferred to CI per AGENTS.md).
- Read final code at each cited file:line to confirm behavior change is present.
- Tests for D1/J2, mergeBackup, and transport binary decoding should be added and readable in the test files.
- No file should still contain the specific bad pattern cited (e.g. `String(raw)` in transport, `+` regex in bytes empty check, unconditional cache invalidation in crew board).
