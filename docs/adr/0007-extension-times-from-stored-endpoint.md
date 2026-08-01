# The Chrome extension times from the stored end point, never from ticks

A browser extension cannot own a process the way the phone's foreground
service does. Manifest V3 service workers are suspended after ~30 seconds of
inactivity; `chrome.alarms` fires at best every 30 seconds. A tick-accumulating
countdown (decrement `remaining` on each interval) would drift, stall, or die
the moment the worker suspends — the timer would freeze mid-focus with the UI
lying about the time.

We instead store the wall-clock end point (`startTime + duration`) on every
state transition and *derive* remaining time whenever anything wakes the
engine: `remaining = endAt - now`. Display surfaces compute per frame from the
same endpoint, so a live fractional-second readout is exact with zero reliance
on worker liveness. A session that elapsed while Chrome was closed completes as
if it had finished on time on the next wake — [[Reconciliation]].

## Considered Options

- **Tick accumulation with alarms:** rejected — the countdown drifts with every
  suspension and cannot account for time that passed while the browser slept.
- **`chrome.alarms` as the only scheduler, no derivation:** rejected — 30-second
  granularity makes completion imprecise by design.
- **End-point derivation (chosen):** wall-clock math is exact at any granularity,
  survives suspension, browser restart, and midnight; the engine never needs to
  "catch up" — it simply computes.

## Consequences

- The engine is pure: given `endAt` and `now`, any surface can render the same
  remaining time. Unit-testable without timers or the browser.
- Completion timing is exact to the second because reconciliation is
  deterministic (no accumulated drift to correct).
- The phone remains the canonical long-lived timer; the extension accepts the
  browser's sleep as a fact of life and reconciles honestly.
