# STATE - live handoff

**Last finished:** B-412 checkpoint 3a recorded (D-43–D-52) and round 2 published, 2026-11-10: the Year page reworked (the phase's steps with people, no badges), the end of the year redrawn, first use, the move previewed in place, Goals' launch day and the review's thin year, in the same [explorer](https://claude.ai/artifact/U5iCrbjucCuc8ZB6H81qhM) (answers in db doc `frame/round2`). Waiting on the user's answers.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Record round 2 of 3a, then 3b | B-412 (B-390) | high | **Round 2 published 2026-11-10, waiting on the user** ([explorer](https://claude.ai/artifact/U5iCrbjucCuc8ZB6H81qhM)). Round 1 is recorded as D-43–D-52 (`design/decisions.md`, lines in `DESIGN.md`). Once answered: read db doc `frame/round2` (ArtifactData `get`, collection `frame`, doc `round2`) and the conversation; record the Year page's second half (the phase's steps with people, D-44's rest), state without badges (glyph and word or word alone, D-52), first use (D-48's drawing), the end of the year (ends by itself vs HR closes it), moving the year on previewed in place, an empty plan's start (carried goals and starters vs a drafted plan), the thin-year review, as D-53 onwards; then 3b (goals and conversations) in the same explorer language per the direction §6, a new artifact. If the user rejects the Year page again, redraw before 3b. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance explorers 3b–3d, then its slices | B-412, then B-405–B-411 | high for explorers | Per the direction §6: 3b goals and conversations, 3c reviews and the end of the year, 3d across Fusion; each answered checkpoint recorded as decisions; then dependency-ordered slices sized to a session each, B-392 and B-389 folded in. |
