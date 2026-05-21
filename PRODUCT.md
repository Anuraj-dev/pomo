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
- Land a real light theme so the app is usable in direct sun — but dark is the canonical experience for this product.

## Success criteria

- A first-time user can start a focus session within 3 seconds of opening the app, with no onboarding.
- A returning user can identify current phase, remaining time, and today's session count in a single glance under 1 second.
- The running timer visibly shows fractional seconds updating; the user perceives the screen as "live."
- Stats screen answers three questions without scrolling: how long have I been doing this, when do I actually focus, am I on streak.
- No screen ships without empty, loading, and error states defined.
- App scores at least WCAG AA on every text surface in both themes, and works correctly at 200 percent system font scale.

## Non-goals

- Gamification beyond the existing streak and daily goal. No XP, no levels, no badges, no leaderboards.
- Social, sharing, or account features. The app is single-user and local-first.
- An AI coach or recommendation surface.
- Cross-device sync beyond the existing LAN desktop client. Phone remains the source of truth.
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
