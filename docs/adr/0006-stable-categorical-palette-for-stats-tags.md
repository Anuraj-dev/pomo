# Stats tags use a stable categorical palette

The Stats Tags section currently uses a hard-coded rainbow palette. That palette
does not belong to Pomo's visual language, and assigning colors by sorted slice
position causes a tag's color to change when the selected time window changes.
At the same time, a pie chart with five to ten categories cannot remain
distinguishable if it is restricted to Pomo's single signal accent and slate
neutrals.

## Decision

1. **Allow a scoped data-visualization exception.** Tag charts may use multiple
   hues. The rest of Pomo continues to use the signal accent, neutral intensity,
   and semantic state colors according to the existing theme.
2. **Use a curated categorical palette.** The palette is designed for Pomo's
   dark and light surfaces and common color-vision deficiencies. It is not a
   copy of the Material default palette.
3. **Make colors stable by tag identity.** A tag keeps its palette slot across
   Stats windows and display surfaces. Color assignment must not depend on the
   current sorted order of slices.
4. **Preserve color when a tag is renamed.** The palette slot belongs to the tag
   identity, not to the tag's displayed spelling.
5. **Bound the visible category count.** Show the largest categories
   individually and combine the remainder into one neutral `Other` category
   rather than recycling colors for multiple tags.
6. **Do not expose manual color selection initially.** A curated palette keeps
   contrast and accessibility guarantees coherent. User customization can be
   reconsidered later as a separate decision.
7. **Provide redundant identification.** Slices use visible separators and the
   legend names every displayed category. Color is not the only identifier.

## Consequences

- Tag colors become part of the tag's durable presentation identity, so tag
  management must preserve that identity through rename operations.
- Stats needs a deterministic overflow policy and a legend that remains usable
  when categories are collapsed into `Other`.
- The chart can feel more colorful than the rest of the app, but the exception
  is intentional: color encodes categorical data rather than app state.
- Existing hard-coded position-based colors should be replaced; changing only
  the hex values would leave the stability and accessibility problems intact.

## Alternatives considered

- **Use only the signal red with opacity steps:** rejected. It does not provide
  reliable separation for five to ten categories, especially for adjacent pie
  slices.
- **Keep recycling the current palette:** rejected. Two tags can share a color,
  and a tag can change color between windows because the palette follows rank.
- **Let every tag choose any color:** rejected for the first version. It makes
  contrast and color-vision behavior dependent on user choices.

## Status

Accepted during the Stats tag-visualization design session on 2026-07-21.
