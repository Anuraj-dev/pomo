# The extension's engine is a single writer in the service worker; surfaces render

The phone enforces one write boundary: everything routes through the service and
instruments never author state. The extension has four surfaces (New Tab, side
panel, popup, badge) in two process lifetimes (worker + pages), which invites the
classic extension failure mode: each page keeps its own timer copy and they
silently disagree. "Which one is real?" is a question the product never asks.

We keep one [[Engine]] in the service worker — the only code that mutates
IndexedDB, `chrome.storage.local`, or engine state. Every surface is a read-only
renderer of the engine's published state snapshot, fed through
`chrome.storage.session` change events plus per-frame derivation of remaining
time from the endpoint. Commands from any surface (start, pause, skip, reset,
extend, tag) are messages to the worker; the worker applies them and republishes.

## Considered Options

- **State per page, reconciled occasionally:** rejected — four divergent copies,
  exactly the drift this product's phone design was built to avoid.
- **Every surface talks to IndexedDB directly:** rejected — no single writer, no
  atomic transitions, and UI code grows database authority.
- **Single-writer worker + read-only surfaces (chosen):** one owner, atomic
  transitions, and the same rule as the phone — instruments render, they never
  own state.

## Consequences

- The engine is fully testable in Node: surfaces are thin enough that behavior
  lives where `bun test` can reach it.
- A surface can be closed and reopened at any moment and will render correctly
  from the latest published snapshot — no surface ever needs to "catch up".
- Message latency between surfaces is one storage-event hop (~ms), which is
  invisible next to the 30-second alarm cadence.
- The worker's suspension is now harmless: pages can still render the live
  countdown from the endpoint while the worker sleeps.
