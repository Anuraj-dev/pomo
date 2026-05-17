# PRODUCT.md

register: product

## Users

Primary: knowledge workers and students who use the Pomodoro technique to defend focus time. They keep the phone face-up on the desk during work, glance at it for remaining time, and check stats once or twice a day to feel their progress.

Secondary: people running the bundled desktop client over LAN, who want their phone to be the authoritative timer.

Mental model the user already has: this is a clock first, a productivity tool second. They are not coming to be coached, gamified, or motivated. They want the timer to start fast, run reliably, and stay out of the way.

## Product purpose

Own a focus session from start to finish without becoming a distraction. The phone is the source of truth for state, history, and the LAN API. The UI's job is to make remaining time legible from across a desk, make phase transitions unmistakable, and make weekly progress feel earned.

## Principles

1. **Calm at rest, alive on transition.** Idle screens are still. Motion is reserved for things that changed: phase ended, session logged, goal hit. No ambient animation.
2. **The countdown is the hero.** Every other element on the timer screen is allowed less attention than the digits and the ring.
3. **Color is state, never decoration.** Coral means focus phase. Teal means break. Gold means a goal threshold was reached. If a color does not encode state, it is a neutral.
4. **One-handed reach.** Primary controls live in the lower 60 percent of the screen. Destructive controls require a second gesture.
5. **Glanceable from a meter away.** Time remaining must be readable without picking the phone up.
6. **Earned familiarity over invention.** Standard Android patterns (bottom nav, settings sections, swipe to dismiss, system back) are features, not constraints.

## Goals

- Reduce time from app open to running timer to one tap, no setup, no modal.
- Make the current phase unmistakable in under a second of looking.
- Make Stats feel like a record of real work, not a dashboard of vanity metrics.
- Land a real light theme so the app is usable in direct sun and on accessibility settings.

## Success criteria

- A first-time user can start a focus session within 3 seconds of opening the app, with no onboarding.
- A returning user can identify current phase, remaining time, and today's session count in a single glance under 1 second.
- Stats screen answers three questions without scrolling: did I focus today, am I on streak, when do I actually do my best work.
- No screen ships without empty, loading, and error states defined.
- App scores at least WCAG AA on every text surface in both themes, and works correctly at 200 percent system font scale.

## Non-goals

- Gamification beyond the existing streak and daily goal. No XP, no levels, no badges, no leaderboards.
- Social, sharing, or account features. The app is single-user and local-first.
- An AI coach or recommendation surface.
- Cross-device sync beyond the existing LAN desktop client. Phone remains the source of truth.
- Custom illustration sets or mascots. Visual identity rests on type, color, motion.

## Tone

Quiet, exact, slightly warm. The voice of a good clock or a well-built field notebook. Copy is short, never cheerful, never coaching. "Focus" beats "Let's focus!". "Break" beats "Time for a well-deserved break."

## Anti-references

What this app is not, even if other Pomodoro apps are:

- Not a productivity coach (Forest, Focus Keeper marketing copy).
- Not a planner (Notion, Todoist).
- Not a gamified habit tracker (Habitica).
- Not a wellness app (Calm, Headspace palette and motion).

What it draws from, in spirit:

- The legibility of a Braun ET66 calculator and Dieter Rams clocks.
- The restraint of Linear and Things.
- The semantic color discipline of Apple's Activity rings.
