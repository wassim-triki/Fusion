# STATE - live handoff

**Last finished:** B-412 3b recorded (D-61–D-66, goal surface rejected → B-413) and checkpoint 3c published, 2026-11-10: [explorer](https://claude.ai/artifact/JQAJc571j9EAvC47tQyNAR) (`plans/B-412-reviews-year-end.html`, db doc `reviews/main`). Waiting on the user's answers.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Record 3c, then 3d | B-412, B-413 (B-390) | high | **3c published 2026-11-10, waiting on the user** ([explorer](https://claude.ai/artifact/JQAJc571j9EAvC47tQyNAR)). Once answered: read db doc `reviews/main` (ArtifactData `get`, collection `reviews`, doc `main`) and the note; record D-67 onwards: where a review stands for the person (N4: who has it and what's next, or a line of steps), a self-review opening on a draft or empty, peers' words named or not, flagged reviews all on one page or one at a time, the full view's grid (rating against goals' grade or potential), releasing (P4: in place or a dialog; P5 the live count as drawn), the overall rating's place in results; plus what was drawn without a question (the round opening by itself with Open it today, managers behind first with nudges, peer input on Home with why you and I didn't work with her enough, finalize and release as one action, Talk it over in our 1:1, the year's end: FY2028 ghost and carried goals, a growth goal from the review as a starter). Then 3d (across Fusion, direction §6) as a new explorer from 3c's file, with B-413 (the goal surface redrawn from its job: panel in three states and Goals, You behind it) drawn first. The user at 3b: "you'll have to actually improve at implementation": check every state renders in a headless pass before publishing. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance explorers 3b–3d, then its slices | B-412, then B-405–B-411 | high for explorers | Per the direction §6: 3b goals and conversations, 3c reviews and the end of the year, 3d across Fusion; each answered checkpoint recorded as decisions; then dependency-ordered slices sized to a session each, B-392 and B-389 folded in. |
