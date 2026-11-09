# STATE - live handoff

**Last finished:** session 3 after the walkthrough, 2026-11-10: B-390 stage 2, Performance's target brief (`plans/B-390-target-brief.md`: eight products studied from their 2026 release notes and docs, eight jobs, personas, IA from first principles, journey, proposed B-068 changes) and a fresh scope page (`plans/B-390-scope-2.html`, https://claude.ai/artifact/VMaufYFnS2JUbPbd4xnbxm, answers in db doc `scope/main`): 4 heroes, 33 features with ladders in 5 areas, 14 not doing, 5 questions (two drawn: sidebar, the year's name). **Waiting on the user's answers.** Before that, session 2: B-390's map and the foundation (D-32).

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Performance scope answers | B-390 | high | When the user has answered the scope page (https://claude.ai/artifact/VMaufYFnS2JUbPbd4xnbxm): read db doc `scope/main` (ArtifactData get, collection `scope`, doc `main`) or the pasted text; record the settled scope in the brief as §7b (like B-164's §6b), the B-068 changes it confirms (brief §8) as decisions, and board children for what the slices will build. Then row 4's design direction may start in the same session if the answers leave nothing open. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance design, then its slices | B-390 | high for the direction and explorers | After row 1: design direction on Core HR's language and D-32, full-size explorers per checkpoint that also settle the remaining Fusion-wide visual rules in context (empty states, panels, navigation, type; the leftovers of B-397 listed in `plans/B-397-foundation.md`), decisions from D-33, then slices sized to fill a session each. |
