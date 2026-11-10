# STATE - live handoff

**Last finished:** B-399 built and In review: root rename, a promotion to a missing job (say why, Add it), a change dated today worded as in effect, leave on the chart's date, Reports' range ends independent, People sorts and the Manager cell, Replay without navigations, 2026-11-10.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Replay in real time | B-419 | medium, profile first | One chart load plus the dated history, any date computed in the browser; verify by dragging in the browser (dev and a production build). |
| 2 | Apply D-32 colours | B-370, B-418 (its colour half) | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone; the accent's light-mode value per D-95 (no brown: charts, highlights). Visual-only: no tests beyond the hook; screens only if asked. |
| 3+ | Performance's slices 1–13 | B-405–B-411, B-392, B-389, B-418 (edges) | per slice | One row of `plans/B-390-slices.md` per session, in its order; Insights is slice 13. Slice 1 (the frame) after row 2's colours. Port the explorers' drawings literally (memory `port-accepted-drawings-closely`); every slice holds D-95 (no brown in light mode, sections' edges lined up). |
