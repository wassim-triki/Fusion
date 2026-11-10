# STATE - live handoff

**Last finished:** B-412 checkpoint 3a, 2026-11-10: the Performance style frame [explorer](https://claude.ai/artifact/U5iCrbjucCuc8ZB6H81qhM) (`plans/B-412-style-frame.html`, db doc `frame/main`), reference screens in `plans/B-390-screens/reference/` (script `data/screens-b412-reference.cjs`). Waiting on the user's answers. Before that, session 4: checkpoint 2 settled and the design direction.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Record checkpoint 3a, then draw 3b | B-412 (B-390) | high | **3a published, waiting on the user** ([explorer](https://claude.ai/artifact/U5iCrbjucCuc8ZB6H81qhM)). Once answered: read db doc `frame/main` (ArtifactData `get`, collection `frame`, doc `main`) and the conversation; record D-43 onwards in `design/decisions.md` (feel, Year layout, navigation N1 and N2, serif T1, first use E1, waiting E7, computed marks, grade display) and a line each in `DESIGN.md`; then 3b in the same language per the direction §6. Was: read `plans/B-390-design-direction.md` first (§6 row 3a), then `design/decisions.md` D-33–D-42 and the brief §7b. Capture the references live (dark, 1440×900) into `plans/B-390-screens/reference/` (stack via `stack.ps1`), then one explorer artifact: the Year page (Amira after launch, Aicha, Mariam; phase switch, the year moved on), Goals › You (Aicha's plan, even weights, quiet coach, line upward), writing a review (Mariam on Aicha's, year beside, grades prefilled, cited draft), in D-32's colours with a theme switch, real Carthage data and photos, labels only, the direction's taste questions preselected. Settles navigation, type, first-use and waiting states in context. Answers become D-43 onwards next session. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance explorers 3b–3d, then its slices | B-412, then B-405–B-411 | high for explorers | Per the direction §6: 3b goals and conversations, 3c reviews and the end of the year, 3d across Fusion; each answered checkpoint recorded as decisions; then dependency-ordered slices sized to a session each, B-392 and B-389 folded in. |
