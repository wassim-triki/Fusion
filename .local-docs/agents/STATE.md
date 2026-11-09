# STATE - live handoff

**Last finished:** session 2 after the walkthrough, 2026-11-09/10: B-390's map (`plans/B-390-map.md`); the Fusion-wide foundation (B-397) in two rounds, ending in **D-32 surface colours** (`design/decisions.md`: dark graphite; light, hero and page one soft tone, cards a step up) and the rules settled without a vote (`plans/B-397-foundation.md`). Before that, session 1: B-398, B-391, B-399's administrator floor and own-role sign-out, B-400, B-401; all closed ○ in LOG.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Performance target brief and scope | B-390 | high | Map exists (`plans/B-390-map.md`). Stage 2 the Core HR way: a researched target brief (`plans/B-390-target-brief.md`: Lattice, Culture Amp, Leapsome, 15Five, Betterworks, HiBob, BambooHR, Workday; personas; IA from first principles; a wide long list beyond what exists, each feature parity / improvement / new) like `archive/plans/B-164-target-brief.md`, then a fresh scope page from it (ladders, heroes, not doing, questions), labels not paragraphs. The first page's chapter 2 (`plans/B-390-scope.html`) is a draft to mine, not a base. Stops at the user's checkpoint. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance design, then its slices | B-390 | high for the direction and explorers | After row 1's checkpoint: design direction on Core HR's language and D-32, full-size explorers per checkpoint that also settle the remaining Fusion-wide visual rules in context (empty states, panels, navigation, type; the leftovers of B-397 listed in `plans/B-397-foundation.md`), decisions from D-33, then slices sized to fill a session each. |
