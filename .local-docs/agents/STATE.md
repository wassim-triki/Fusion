# STATE - live handoff

**Last finished:** B-412 3a round 2 recorded (D-53–D-60, D-46 reopened) and checkpoint 3b published, 2026-11-10: [explorer](https://claude.ai/artifact/4nFFGFPJeoYnAF3nPzH3kd) (`plans/B-412-goals-conversations.html`, db doc `goals/main`), the old objective drawer captured as its reference. Waiting on the user's answers.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Record 3b, then 3c | B-412 (B-390) | high | **3b published 2026-11-10, waiting on the user** ([explorer](https://claude.ai/artifact/4nFFGFPJeoYnAF3nPzH3kd)). Once answered: read db doc `goals/main` (ArtifactData `get`, collection `goals`, doc `main`) and the conversation; record D-61 onwards: a goal opened as panel or page per state (closes D-53), Goals, Company's first view, updating progress (panel mode or dialog; the rail with where it should be now; How it's going from the pace), approval from Needs you with what changed, the 1:1 as the page (agenda from sources, notes mark what was talked about or ticks), Feedback with the wall and starter values, lists and empty parts (E2–E6), quick looks and short tasks (P1, P2); then 3c (reviews and the end of the year: the round from the Year page, self-review, peer input, calibration by exception, release, results read, the year's end) per the direction §6 as a new explorer, reusing 3b's file as the base. Taste notes so far: the user liked the old objective drawer (reference shots in `plans/B-412-screens/reference/`); no status glyphs unless the icons are really good; least friction wins for demos. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance explorers 3b–3d, then its slices | B-412, then B-405–B-411 | high for explorers | Per the direction §6: 3b goals and conversations, 3c reviews and the end of the year, 3d across Fusion; each answered checkpoint recorded as decisions; then dependency-ordered slices sized to a session each, B-392 and B-389 folded in. |
