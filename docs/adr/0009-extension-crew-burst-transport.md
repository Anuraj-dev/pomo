# The extension talks to Crew relays in bursts, not live connections

Status: superseded by ADR-0012. Chrome no longer has Crew.

The phone holds WebSockets to Nostr relays open for live Crew updates. A
Manifest V3 service worker cannot: it is suspended ~30 seconds after its last
event, and suspension kills any open socket silently. A naive port would keep a
"connection" the worker cannot keep, and the leaderboard would silently freeze
exactly when it matters most — during a focus session.

We adopt [[Burst]] discipline, which is already the phone's *pull* pattern:
connect, transact, close — REQ/EVENT/EOSE/CLOSE for refresh, EVENT/OK for
publish — each bounded by the same 2750 ms relay timeout, all relays concurrent.
Bursts are driven by the 30-second alarm wakeups and by explicit user actions.
Live [[Observe]] still exists, but only from a page context (New Tab or side
panel) and only while the Crew instrument is visible — the same lifetime rule
the phone already has ("Relay subscriptions live only while Crew is visible").

## Considered Options

- **Long-lived worker WebSocket with keepalives:** rejected — the browser owns
  the worker's lifetime; a 25-second ping game is fragile and Chrome can suspend
  regardless.
- **Observe from the worker anyway:** rejected — connection dies on suspension,
  exactly the silent-freeze failure we refuse to ship.
- **Bursts + page-context Observe (chosen):** refresh and publish are atomic and
  bounded; live streaming happens where the browser guarantees liveness.

## Consequences

- Refreshes are eventually consistent at worst (30 s) instead of streaming —
  the board shows honest freshness (`SYNCING`, last-updated age) per product
  rules instead of pretending to be live.
- Burst transport is testable against a local relay with deterministic timeouts,
  in the same way the phone tests against a fake relay.
- If a future MV3 change allows held sockets, Observe can move into the worker
  without touching the engine.
