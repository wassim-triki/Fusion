# STATE - live handoff

**Last finished:** B-412 explorer 3e built and published (https://claude.ai/artifact/QQGp4QQ5DBTw41cPHss1Fz, `plans/B-412-ending.html`, answers in db doc `ending/main`), 2026-11-10; waiting on the user's answers.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Record 3e | B-414, B-415, B-416, B-417 (B-412) | medium | Waits on the user's answers in [3e](https://claude.ai/artifact/QQGp4QQ5DBTw41cPHss1Fz) (db doc `ending/main`; snapshot to `plans/B-412-ending.answers.json`). Record decisions from D-88 in `design/decisions.md` (the drawn calls too: Insights as Fusion's one dashboard, top level beside Home, People · Performance · Reports, Core HR's Reports moving into it; HR insights leave the Year page; setup as one page with the year as its object), close or send back B-414–B-417, then update slices 11–13 in `plans/B-390-slices.md` (Insights becomes its own slice). If the user just moves on, the stars stand. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance's slices 1–13 | B-405–B-411, B-392, B-389, B-414–B-417 | per slice | One row of `plans/B-390-slices.md` per session, in its order; slices 1–10 don't wait for 3e, 11–13 do. Slice 1 (the frame) after row 3's colours. Port the explorers' drawings literally (memory `port-accepted-drawings-closely`). |
