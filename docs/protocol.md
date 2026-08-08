# Pomo Phone Protocol

The Android app hosts a local API from `PomodoroService` using Ktor CIO. Desktop
clients are remote controls and displays. The phone is the live clock while
synced; the NodeMCU desk may run a local Pomodoro while offline and, on
reconnect, append completed history and optionally hand a live timer to the
phone via adopt. There is never more than one live clock at a time.

Default base URL:

```text
http://<phone-ip>:9876
```

The pairing payload shown in Android Settings contains the base URL and token:

```json
{
  "url": "http://<phone-ip>:9876",
  "token": "<pairing-token>"
}
```

Android Settings can also render this payload as a QR code. Desktop tooling may
print or consume the same JSON payload; it does not change the protocol.
The Android scanner entry uses the same payload shape and only compares it to
the current phone pairing token; scanning does not mutate canonical phone state.

## Discovery

While the phone API is serving, the phone advertises itself over mDNS:

```text
service type: _pomo._tcp
service name: Pomo
port:         the configured phone API port (default 9876)
```

LAN clients should resolve the phone's address this way rather than storing an
IP, which changes whenever the router issues a new DHCP lease. Discovery does
not carry the pairing token — clients still need the token from the pairing
payload. Advertising follows the phone API's own settings: it stops when the
API is disabled and when wifi-only mode has no active LAN network. Async mDNS
registration failures on the phone retry indefinitely every 5 seconds while
the service still wants the port advertised.

When multiple `_pomo._tcp` responders exist (e.g. dev + release packages, or
two phones), clients must not trust the first mDNS answer alone. The desk
firmware probes each candidate with authenticated `GET /api/status` and selects
the first HTTP 200. A configured host/port override wins outright and skips
mDNS.

Clients on networks that block multicast should fall back to a manually
configured host and port.

## Authentication

REST requests must include:

```text
X-Pomo-Token: <pairing-token>
```

Missing or invalid REST tokens return:

```http
401 Unauthorized
```

```json
{
  "success": false,
  "error": "unauthorized"
}
```

WebSocket clients authenticate with their first message:

```json
{
  "type": "hello",
  "token": "<pairing-token>"
}
```

Invalid WebSocket tokens are closed without subscribing the client.

## Timer State

Timer state is JSON-compatible with `TimerState.kt`. Status responses and
WebSocket `state` frames also include additive `server_time` (phone wall-clock
epoch seconds) so offline-capable clients can align session starts:

```json
{
  "status": "running",
  "phase": "work",
  "next_phase": "short",
  "start_time": 1710000000.0,
  "duration": 1500.0,
  "remaining": 1432.0,
  "completed": 2,
  "daily_goal": 8,
  "date": "2026-05-07",
  "last_action_time": 1710000000,
  "tag": "",
  "version": 2,
  "server_time": 1710000100
}
```

Allowed values:

```text
status: stopped | running | paused
phase:  work | short | long
```

Clients MUST ignore unknown fields. `server_time` is additive and optional for
legacy display-only clients.

Desk / offline-capable clients SHOULD use `server_time` with `remaining` to
project the live countdown onto wall-clock now (end ≈ `server_time` +
`remaining` while running) so delayed or out-of-order state frames cannot
rebase the display to an older remaining. When both a prior epoch basis and a
new snapshot exist, apply the snapshot (with lag projection) **before**
re-anchoring the cached epoch so projection uses the previous basis. For the
same running session (`start_time` + `phase`), clients SHOULD ignore snapshots
with an older `server_time`, and SHOULD reject remaining inflation that is not
explained by a larger `duration` (e.g. extend).

## REST Endpoints

### GET /api/status

Returns the current phone-owned timer state plus `server_time` (epoch seconds).

```bash
curl -H "X-Pomo-Token: $TOKEN" "$PHONE_URL/api/status"
```

### POST /api/toggle

Starts, pauses, or resumes the current timer.

```bash
curl -X POST -H "X-Pomo-Token: $TOKEN" "$PHONE_URL/api/toggle"
```

Response:

```json
{
  "success": true,
  "state": { "...": "TimerState" }
}
```

### POST /api/skip

Skips to the next phase and returns the new state.

```bash
curl -X POST -H "X-Pomo-Token: $TOKEN" "$PHONE_URL/api/skip"
```

### POST /api/reset

Resets the current phase timer and returns the new state.

```bash
curl -X POST -H "X-Pomo-Token: $TOKEN" "$PHONE_URL/api/reset"
```

### POST /api/extend

Adds a positive seconds delta to the currently running timer. Add-time is
uncapped by design; stopped and paused timers are left unchanged.

```bash
curl -X POST \
  -H "X-Pomo-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"seconds_delta":300}' \
  "$PHONE_URL/api/extend"
```

### GET /api/config

Returns timer configuration:

```json
{
  "durations": {
    "work": 25,
    "short_break": 5,
    "long_break": 15
  },
  "long_break_after": 4,
  "daily_goal": 8
}
```

### POST /api/config

Updates timer configuration on the phone. Payloads may be partial; omitted or
invalid values keep the existing phone setting. If the timer is not running, the
current phase duration is recalculated from the merged config.

```bash
curl -X POST \
  -H "X-Pomo-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "durations": { "work": 25, "short_break": 5, "long_break": 15 },
    "long_break_after": 4,
    "daily_goal": 8
  }' \
  "$PHONE_URL/api/config"
```

Accepted fields:

```text
durations.work       positive integer minutes
durations.short_break positive integer minutes
durations.long_break positive integer minutes
long_break_after     positive integer
daily_goal           non-negative integer
```

### POST /api/sessions/import

Flushes completed offline sessions from a desk (or similar) into phone Room
history. Auth: `X-Pomo-Token`. Idempotent on `client_id` and on session `start`
primary key: duplicates are listed in `accepted` without double-counting.

```bash
curl -X POST \
  -H "X-Pomo-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "desk",
    "sessions": [
      {
        "client_id": "esp-1-a3f0",
        "type": "work",
        "duration": 1500,
        "completed": true,
        "start": 1710000000,
        "tag": ""
      }
    ]
  }' \
  "$PHONE_URL/api/sessions/import"
```

Body fields:

```text
source              optional string (e.g. "desk"); informational only
sessions[]          array of session objects
  client_id         required non-empty string (desk-side idempotency key)
  type              work | short | long
  duration          positive integer seconds
  completed         must be true (only completed sessions are imported)
  start             optional epoch seconds; if omitted, phone assigns from now
  tag               optional string
```

Validation:

- `type` must be `work`, `short`, or `long`.
- `duration` must be `> 0`.
- `completed` must be `true`.
- `client_id` must be non-empty.
- When `start` is present, it must fall in a plausible window: not older than
  14 days, not more than a few minutes in the future.
- When `start` is omitted for multiple sessions, the phone assigns starts from
  `now - duration` walking backward so list order is chronological and primary
  keys do not collide.

Response:

```json
{
  "success": true,
  "accepted": ["esp-1-a3f0"],
  "rejected": [
    { "client_id": "bad", "error": "invalid type" }
  ]
}
```

The response is terminal for each row that appears in `accepted` or
`rejected`: the desk drops accepted rows and quarantines rejected rows after
logging their `client_id` and error. A successful HTTP response with a valid
`accepted` array therefore allows synchronization to continue even when a row
is invalid. Transport failures, non-200 responses, malformed responses, or a
missing `accepted` array are retryable and leave the corresponding queue rows
queued.

After a successful import the phone refreshes today's completed count and
broadcasts timer state (WebSocket + local UI).

### POST /api/timer/adopt

Hands a live offline (or shorter) timer from the desk to the phone. Auth:
`X-Pomo-Token`. **Least remaining wins** when both sides have a live timer.

Adoption rules (phone becomes sole clock on success):

1. **Phone STOPPED** → always adopt the desk payload.
2. **Same session** (matching `start_time` + `phase`) → always adopt (desk
   refresh of remaining / status).
3. **Both live** (phone and desk `running` or `paused`) on **different**
   sessions → adopt only when desk `remaining` is **strictly less** than phone
   `remaining` (`payload.remaining < current.remaining`).
4. Otherwise → **HTTP 409** `timer_busy`: phone keeps its clock; desk must snap
   to phone state. This includes phone remaining ≤ desk remaining (equal or
   longer desk), and any non-live payload while the phone is live on a different
   session.

There is never dual live ownership after merge: one winner; once SYNCED the
phone owns the live clock.

```bash
curl -X POST \
  -H "X-Pomo-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "running",
    "phase": "work",
    "remaining": 900,
    "duration": 1500,
    "start_time": 1710000000.0,
    "completed": 2,
    "daily_goal": 8,
    "tag": ""
  }' \
  "$PHONE_URL/api/timer/adopt"
```

Body fields:

```text
status       stopped | running | paused
phase        work | short | long
remaining    seconds remaining (>= 0, <= duration)
duration     total phase seconds (> 0)
start_time   epoch seconds (float-compatible); must be > 0 when status is
             running or paused (same-session identity); may be 0 / omitted
             when status is stopped
completed    completed work blocks today (>= 0); phone treats Room as
             canonical after adopt and does not inflate from a higher desk
             count (import matching sessions first via /api/sessions/import)
daily_goal   daily goal (>= 0)
tag          active tag string (may be empty)
```

Success response:

```json
{
  "success": true,
  "state": { "...": "TimerState" }
}
```

Conflict (HTTP 409) — phone live and phone remaining ≤ desk remaining (or same
session not matching and desk not strictly shorter):

```json
{
  "success": false,
  "error": "timer_busy",
  "state": { "...": "TimerState" }
}
```

On success the phone applies the payload into `OfflineTimer` / service state,
persists, updates notification, and broadcasts over WebSocket.

### GET /api/history

Returns Room-backed canonical history keyed by the phone's local calendar date:

```json
{
  "2026-05-07": {
    "completed": 3,
    "work_minutes": 75,
    "break_minutes": 10,
    "sessions": [
      {
        "type": "work",
        "start": 1710000000,
        "duration": 1500,
        "completed": true
      }
    ]
  }
}
```

Sessions that cross midnight are split into per-date segments. Work and break
seconds are rounded up to minutes for each date segment. A completed work
session increments the completed-session count only on the final segment, so a
single session never double-counts against the daily goal.

## WebSocket

Connect to:

```text
GET /ws
```

First message:

```json
{
  "type": "hello",
  "token": "<pairing-token>"
}
```

State messages are sent immediately after authentication and after every state
change. `data` matches `GET /api/status` (TimerState fields plus `server_time`):

```json
{
  "type": "state",
  "data": { "...": "TimerState", "server_time": 1710000100 }
}
```

Clients should treat WebSocket updates as display/cache updates. Commands should
still use the authenticated REST endpoints.

### Event Frames

Events describe something that happened, as opposed to current state. They are
sent to every subscribed client:

```json
{
  "type": "event",
  "event": "phase_complete",
  "phase": "work"
}
```

```text
event: phase_complete
phase: work | short | long
```

`phase_complete` fires only when a phase runs down to zero on its own. Skip,
reset and pause produce a state message and no event, which is what lets a
hardware client sound an alarm on a real completion and stay silent on a manual
action. The event is dispatched before the state message for the same
transition, but this is not a delivery-order guarantee: the two frames are sent
independently, so clients must process each on its own and tolerate either
arrival order.

Clients MUST ignore frames whose `type` they do not recognise. New event types
may be added without a protocol version bump.

## Client Contract

Remote clients should:

- Discover the phone through mDNS where possible, with a manual host fallback.
- Ignore WebSocket frames with an unrecognised `type` and ignore unknown JSON fields.
- Store `url` and `token` from the pairing payload.
- Use REST endpoints for commands.
- Use WebSocket updates or polling for display.

**Desktop clients** remain thin: they must not author canonical timer or history
state. They may cache the last successful state only for stale/offline display;
cache writes are best-effort and local-only.

**NodeMCU desk (hybrid) may append history and adopt a live timer.** This is the
exception to “clients never author state.” While the phone is reachable (SYNC),
the phone is the sole live clock and the desk mirrors WebSocket (+ REST) state
and sends REST commands. While the phone is unreachable (OFFLINE), the desk may
run a local Pomodoro (buzzer, buttons, countdown), persist a live timer snapshot
across reboot, and queue completed sessions (LittleFS temp+rename; real phase
`start_time` when known). On reconnect it:

1. Completes enter-SYNC from the first authenticated WebSocket `state` frame
   while CONNECTING. Authenticated `GET /api/status` probes only check
   reachability/token and never promote the desk to SYNCED. Marker stays `.`
   until the pipeline finishes.
2. Flushes completed offline sessions with `POST /api/sessions/import` (append-only;
   accepted client IDs are dropped and rejected IDs are quarantined with serial
   diagnostics; unaccepted or failed responses remain queued and retry on the
   fixed ~5-second interval).
3. If the desk still has a running/paused timer, may call `POST /api/timer/adopt`
   when the phone is stopped, or when both are live and desk remaining is
   strictly less than phone remaining (least-remaining). Same session is always
   allowed. Live payloads require `start_time > 0`; after adopt the phone sets
   `completed` from Room (desk completed is not authoritative).
4. On adopt `409` (phone remaining ≤ desk remaining on a different session) or
   when the desk does not try adopt, snaps to phone state.
5. Caches `server_time` and defers `GET /api/config` until SYNC is stable;
   healthy refresh is ~5 minutes and failed refreshes retry after ~1 minute.
   `daily_goal` may be `0`.

Never run two live clocks after merge: least remaining wins; once SYNCED the
phone owns the sole live clock. Opening the Pomo app on the LAN is enough for
the desk to rediscover (fixed ~5-second retries after leave-SYNC, plus REST
reachability on a known host) and sync; there is no separate desk “push sync”
command. A stale WebSocket is detected after ~20 seconds and gets bounded soft
resync while phone ownership is retained; unreachable recovery eventually
returns to OFFLINE.
