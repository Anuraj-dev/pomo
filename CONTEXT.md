# Pomo

Glossary for the Pomo focus-timer domain. The phone is the source of truth for
timer state, history, and stats. This file defines the language we use to talk
about the product; it is not a spec and carries no implementation detail.

## Language

**Work block**:
One continuous run of the focus phase. It is *completed* when it runs to its
scheduled end (including any add-time); it is *partial* when Skip ends it early.
Reset abandons a block and records nothing at all. Historically a fixed length
(e.g. 25 min); once add-time exists it is variable-length. The unit that history
rows and the long-break cadence count.
_Avoid_: session (ambiguous — see below), pomodoro, interval.

**Session**:
Informal synonym for a Work block. Prefer "Work block" when precision matters,
because "session" is also used loosely for "a stretch of using the app".

**Focus minutes**:
Total time actually spent in the focus phase, summed across Work blocks —
including the partial time of a block ended by Skip, and excluding any block
abandoned by Reset. Time-honest: it measures real focus time, independent of
whether a block was completed. The **headline metric** — what Stats lead with
and what any ranking sorts on.
_Avoid_: focus time when a unit is needed, productivity, score.

**Cadence count**:
The running count of completed Work blocks in the current cycle. Drives the
long-break trigger (`longBreakAfter`) and the launch pips. Only completed blocks
increment it; partial (skipped) blocks contribute Focus minutes but never the
count. Kept for cadence even though Focus minutes is the headline metric.
_Avoid_: completed, session count (when it could mean the headline metric).

**Daily goal**:
A target expressed as a count of completed Work blocks per local calendar day.
Remains count-based even though Focus minutes is the headline metric elsewhere.

## Cues

**Completion cue**:
The sound and/or vibration Pomo emits the moment a phase ends and the timer
parks at the next phase. It is a notice, not a transition: the timer never
auto-advances, so the cue only tells the member a phase finished. It has two
modes — one-shot and Ring.
_Avoid_: alarm (reserve for the Ring mode), beep, chime, alert.

**One-shot** (cue mode):
The default Completion-cue mode: a single brief sound plus one haptic, then
silence. Honours the phone's sound mode.

**Ring** (cue mode):
An opt-in Completion-cue mode that loops sound and vibration until the member
acknowledges it or a one-minute cap elapses, then self-silences. Applies to all
three phase completions. Audio honours the phone's sound mode (silent/DND stay
quiet; vibration still fires). This is the only context where "alarm" is apt.
_Avoid_: alarm clock, snooze (there is no snooze; the cap just silences).

**Acknowledge / Dismiss**:
Any act that silences a ringing cue — a Dismiss control or any timer command
(Start, Skip, Reset, Add-time). Dismiss only silences; it leaves the timer
parked at the next phase. The one-minute cap silences without acknowledgement.
_Avoid_: snooze, stop alarm, cancel.

## Leaderboard

**Crew**:
A group of people who compare focus stats. There is no server and no admin; a
Crew is just everyone who holds the same join code. Members rank against each
other on Focus minutes.
_Avoid_: server, room, group, channel, lobby.

**Join code**:
The single string that defines and grants entry to a Crew. Carries the Crew id,
its immutable human-readable name, the relay list, and the shared encryption
key. Holding it is the only thing that makes you a member; there is no approval
step.
_Avoid_: server code, invite link, password.

**Crew name**:
The human-readable label chosen when a Crew is created and fixed by its Join
code. It identifies the Crew in product UI but is not its protocol identity.
_Avoid_: Crew id, channel name, mutable title.

**Identity key**:
The per-device keypair that signs a member's snapshots. The real, anonymous
identity of a member; the display name is just a self-asserted label on top of
it. No accounts, no login.
_Avoid_: account, user id, profile.

**Display name**:
A member's self-asserted human-readable label. It is not unique and does not
identify the member; the Identity key does.
_Avoid_: username, handle, account name.

**Recovery file**:
A passphrase-protected portable backup of an Identity key and its Crew
memberships. It restores the same member; it is never an invitation.
_Avoid_: Join code, account backup, public QR.

**Snapshot**:
The small, signed, Crew-encrypted bundle of stats a member publishes to the
relays for others to rank. It shares aggregate performance, never individual
Work block timestamps; it is append-only and the latest one wins.
_Avoid_: report, sync payload, update.

**Ranking window**:
The span of recent Focus minutes compared by a Crew: each member's phone-local
Today, current local date plus the previous 6 dates, current local date plus the
previous 29 dates, or All-time.
_Avoid_: week, month (both imply calendar boundaries).

**Rank**:
A member's position by Focus minutes within a Ranking window. Equal totals share
the same Rank; row order among tied members is not a competitive result. A member
with zero Focus minutes in that window is unranked.
_Avoid_: place when it implies a tie-break winner.

**Hidden member**:
An Identity omitted from one phone's view of a Crew. Hiding is a local filter,
not removal from the Crew and not an administrative action.
_Avoid_: banned member, kicked member, blocked account.

**Inactive member**:
A member whose latest completed Focus Work block is more than 30 days old.
Inactive members keep their aggregate stats but do not participate in active
Ranks.
_Avoid_: deleted member, former member (membership cannot be observed remotely).

**Relay**:
A public Nostr-style server, run by strangers, that stores and forwards
snapshots. Pomo uses several for redundancy and owns none of them. Their
existence is what makes "decentralized" mean "no central authority", not "no
servers anywhere".
