# Profile takes the fifth nav tab and Settings moves inside it

Pomo has no identity surface. A member's [[Display name]] lives *inside* Crew —
`CrewStore` stamps it on every membership — so a member who is in no Crew has
nowhere to be anybody. As [[Profile]] grows (achievements, self-described
fields), it needs a home, and the bottom nav is already full: Timer, History,
Crew, Stats, Settings.

We chose to give [[Profile]] the fifth tab and demote Settings to a row inside
it. Settings is a destination you visit rarely and deliberately; identity is the
thing the product is about to grow. One extra tap on Settings buys a first-class
home for [[Profile]], and every phone has trained its owner to look for settings
behind the person icon.

## Considered Options

- **Profile as a header row inside Settings** (the Android Settings pattern):
  rejected — cheapest and breaks nothing, but it makes [[Profile]] permanently
  subordinate to Settings, which is backwards for a surface we intend to grow.
- **A sixth nav tab:** rejected — five is already the practical ceiling.
- **Profile replaces Settings in the nav (chosen):** Settings survives intact,
  pushed as a sub-page from Profile.

## Consequences

- Bottom nav becomes Timer · History · Crew · Stats · **Profile**. Settings is
  no longer reachable in one tap; nothing in it is lost or reorganized.
- [[Display name]] is promoted out of `CrewStore` to profile-level storage: one
  name, owned by the member identity, not by any [[Crew]]. This is what the
  glossary already asserts — a [[Profile]] belongs to one member identity, not
  to a [[Crew]].
- **One name everywhere, permanently.** Per-Crew aliases are foreclosed. Nothing
  is lost today (`updateDisplayName` already writes one name across all
  memberships), but this closes the door deliberately.
- A one-time migration lifts the [[Display name]] off any existing membership
  into the Profile. A member with no name starts empty; the `"Me"` fallback in
  `CrewRepository.joinCrew` is removed.
- The Crew create and join sheets stop asking for a name. They read the Profile.
  If the [[Display name]] is unset at that moment, the sheet asks once, inline,
  and writes to the **Profile** — not to that Crew. One name, set wherever it is
  first needed, never a dead end and never a per-Crew field.
- The minimal Profile is: identity header ([[Display name]] + [[Key
  fingerprint]]), a headline stat strip, and the Settings row. No Crew list (Crew
  is the adjacent tab), no avatar (image picking, storage, and relay bytes are a
  feature, not a detail — a letter tile from the name gets most of the weight for
  free), no backup/restore (it stays in Settings).
- The stat strip exists partly to reserve the slot achievements will occupy, so
  the page is not redesigned when they land.

## Decision Note 0004-A: Composition

Chosen from rendered options by Snehit on 2026-07-14: the **ledger** composition.

Flat and typographic. No cards on the Profile: hairline rules divide the stat
strip, the [[Display name]] is the largest element on the screen, and the letter
tile is generated from the name. The Settings row is a hairline-bounded list row,
not a raised surface. Profile reads as the quieter sibling of Stats, which is the
only other screen that leads with numbers.

Rejected: a centered-avatar card stack (correct but generic — it could be any
app), and an accent-striped identity banner (the Signal stripe is the app's
alarm colour and risks reading as a warning on a page that is not warning
anybody).

## Decision Note 0004-B: The Name Is A Display Name, Not A Username

Approved in-thread by Snehit on 2026-07-14.

Names remain **non-unique**, and the product calls the field **[[Display name]]**
— never "username", "handle", or "account name", per the glossary's `_Avoid_`
rule on that term.

Pomo has no backend and no name registry ([[ADR 0001]]: no infrastructure we
own). "Username" carries promises the system cannot keep — uniqueness, ownership,
something you log in with. A member reading "username" will assume the name is
theirs to hold; it is not, and two members of one [[Crew]] may share one. A
key-derived suffix (`@snehit·4f2a`, Discord-style) was considered and rejected as
premature: it solves a disambiguation problem we have not yet felt, and it makes
the name look owned when it is not.

Disambiguation is instead served by the [[Key fingerprint]], shown under the name
on the Profile. It is derived from `CrewIdentityStore.publicKey()` and costs
nothing.

## Decision Note 0004-C: Crew Settings Stay In Crew; Rename Is Deferred

Crew-scoped settings (hide/unhide member, leave, relays) get an entry on the Crew
screen rather than a section in the global Settings: they are per-Crew, and a
single global page would have to invent a Crew picker to hold them.

Renaming a [[Crew]] is **deferred to the join-code redesign**, not shipped here.
The [[Crew name]] rides inside the [[Join code]] payload (`CrewJoinCodeCodec`
encodes `crewName`), so a rename never reaches members who already joined — it
would be silently local-only. Broadcasting a rename over the [[Relay]] means
widening the wire (additively, with nullable fields — never a
`CrewDefaults.PROTOCOL_VERSION` bump, which would drop this build from older
builds' boards) and inventing a last-writer-wins rule. That is a protocol
decision, and it does not belong inside a Profile project. The join-code redesign
is the moment to decide whether the name belongs in the payload at all.
