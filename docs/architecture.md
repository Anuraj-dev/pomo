# Architecture

Pomo is mobile-primary: the Android app is the canonical Pomodoro system,
and every control surface talks to the phone-owned service state.

## Source Of Truth

`PomodoroService` is the write boundary for timer state. These inputs all route
through service methods:

- Timer screen buttons
- Notification actions
- Home-screen widget actions
- Authenticated HTTP commands from `PhoneServer`
- The NodeMCU desk device, through the same authenticated HTTP commands
  (including offline history import and live timer adopt)

Room is the canonical history store. Desktop clients may display or cache data,
but they should not merge, overwrite, or author timer/history state. The desk
may append completed offline sessions and hand over a live timer under the
least-remaining adopt rule (phone stopped always; same session always; both
live only when desk remaining is strictly less); it does not dual-own the clock
while synced.

## Runtime Flow

```text
User / widget / notification / desktop API
        ↓
PomodoroService
        ↓
OfflineTimer
        ↓
Room history + saved timer state
        ↓
State broadcast
        ↓
UI, notification, widget, WebSocket clients
```

## Key Modules

```text
MainActivity.kt
```

Hosts navigation, starts and binds to `PomodoroService`, and forwards state
updates to the currently visible fragment.

```text
service/PomodoroService.kt
```

Owns timer commands, saved state, notification updates, widget broadcasts,
completion side effects, pairing payloads, and the embedded phone API lifecycle.

```text
timer/OfflineTimer.kt
```

The normal local countdown engine. Despite the legacy name, this is no longer a
fallback path; it is how the phone runs the timer.

```text
db/
```

Room database, DAO, session entities, daily stats entities, and the repository
used by service and UI. Completed sessions are recorded locally and reflected in
Stats and History screens. Room also holds the durable Crew read model, keyed by
Crew and member Identity key; Crew aggregates never become canonical history.

```text
crew/
```

Builds this phone's aggregate Snapshot from canonical Room history, exchanges
encrypted Snapshots through relays, incrementally upserts valid member Snapshots
into the Room-backed Crew read model, and derives rankings locally.

```text
network/PhoneServer.kt
```

Embedded Ktor CIO server. Exposes authenticated REST commands and a WebSocket
state stream for desktop and desk clients. Additive protocol surfaces include
`server_time` on status/state, `POST /api/sessions/import` (history append from
offline desk queue), and `POST /api/timer/adopt` (live timer handoff under the
least-remaining rule: phone stopped always; same session always; both live on
different sessions only when desk remaining is strictly less than phone
remaining; otherwise HTTP 409 `timer_busy`).

```text
ui/
```

Fragments render service state and Room data. They should not call a laptop or
external timer server directly.

```text
widget/TimerWidgetProvider.kt
```

Displays phone timer state and sends widget actions back to the Android service.

## State Updates

When the timer changes, `PomodoroService`:

1. Updates `currentState`.
2. Persists meaningful state changes through `UtilPreferenceManager`.
3. Updates the foreground notification.
4. Broadcasts `com.pomo.STATE_UPDATE`.
5. Updates all widgets.
6. Broadcasts state to connected WebSocket clients.

## History

Completed sessions are written through `HistoryCacheRepository` into Room. Daily
stats are derived locally from those session writes. Sources of history writes:

- Local phone completions and partial work skips (`OfflineTimer`)
- Desk offline flush via `POST /api/sessions/import` (append-only, idempotent on
  `start` / `client_id`; missing starts are assigned on the phone)

The app intentionally does not import or reconcile legacy laptop history.

History dates use the phone's local calendar day. When a session crosses
midnight, the repository splits it into per-date segments, rounds each segment's
seconds up to minutes, and counts a completed work session only on the final
segment.

## Crew Read Model

Crew data is a non-authoritative local projection of members' latest valid
Snapshots. Each row is keyed by `(crewId, identityPublicKey)` and upserted only
when the incoming Snapshot is newer. The UI observes this projection immediately;
concurrent relay refreshes improve it incrementally in the background.

Ranking-window projections are computed outside composition and exposed as
immutable UI state. The Crew screen renders member rows through a stable-keyed
virtualized lazy list; it does not sort or compose the complete board during each
row recomposition.

Performance verification uses deterministic 500-member Snapshots and fake relay
timelines for incremental/partial/offline states. Ranking and window calculation
have a focused benchmark; cached board presentation has an Android
Macrobenchmark. Public relays are excluded from pass/fail CI timing.

Crew storage is separate from private session history. A remote aggregate must
never create, edit, or reconcile a local History row.

Identity private keys and Crew shared keys are stored only as ciphertext wrapped
by a non-exportable Android Keystore AES key. Public metadata and aggregate Room
projections remain readable without unwrapping private material. Signing,
decryption, and explicit Recovery export unwrap only the required secret.

## Pairing And Remote Clients

The phone generates a pairing token in dedicated non-backed-up shared
preferences. REST clients send it with `X-Pomo-Token`; WebSocket clients send it
in their first `hello` message.

Remote clients are thin:

- Commands go to the phone API.
- Display state comes from polling or WebSocket updates.
- Local desktop cache is only for stale/offline display.
- Desktop background services refresh cache only; they do not own timer
  lifecycle, history, or sync.

The NodeMCU desk device (`firmware/PomoLink/`) is a **hybrid** client:

- **SYNC:** phone is the sole live clock. Desk mirrors WebSocket (+ REST) state,
  sends control commands, and buzzes on `phase_complete` from the phone.
- **OFFLINE:** desk owns countdown, buzzer, and buttons. Completed sessions are
  queued locally (bounded). On reconnect the desk flushes history via
  `POST /api/sessions/import` and may `POST /api/timer/adopt` if it still holds
  a running/paused timer: always when the phone is stopped; when both are live,
  only if desk remaining is strictly less than phone remaining (least-remaining);
  same session is always allowed. HTTP 409 `timer_busy` (phone remaining ≤ desk
  remaining on a different session) means the desk abandons its local live clock
  and snaps to the phone.

There is never dual live ownership after merge: one winner under least
remaining; once SYNCED the phone owns the sole live clock.

While serving, the service advertises `_pomo._tcp` over mDNS so LAN clients
resolve the phone by name. Registration failures retry with bounded backoff;
desk discovery token-probes multiple responders rather than taking the first.

See [protocol.md](protocol.md) for endpoint details.
