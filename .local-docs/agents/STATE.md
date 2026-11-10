# STATE - live handoff

**Last finished:** B-412 3d recorded (D-76–D-87; goal surface accepted, B-413 closed; year's end, setup, the sidebar's foot and competencies' empty cells sent to 3e as B-414–B-417) and Performance's slices laid out in `plans/B-390-slices.md`, 2026-11-10.

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**How the user wants this work done (2026-11-09):** one chapter at a time, each with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. UI choices drawn, labels not paragraphs, per situation, not universal; decide the obvious yourself; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, never thumbnails of today's layouts. Redesigns make bold structural decisions from the surface's job, not restyled card columns. Feel: warm and friendly like BambooHR and Upwork, modern and professional. Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `design-friendly-not-enterprise`. Superseded pages, don't ask the user to answer them: `plans/B-390-scope.html`, `plans/B-397-foundation.html`.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Explorer 3e: what 3d sent back | B-414, B-415, B-416, B-417 (B-412) | high | One explorer, Carthage's real data, every state rendered headless dark and light before publishing (`$CLAUDE_JOB_DIR/tmp/shots3d.cjs` was 3d's pattern; rewrite it for this job). **The year's end and dashboards (B-414, D-85):** research where HRIS dashboards live (Lattice, Culture Amp, HiBob, BambooHR, Workday) and decide yourself: one per module or one across Fusion; draw the administrator's year's end with real figures and charts (ratings spread, goals met, carried goals, against last year), no summary tiles (D-75), dataviz skill for the charts. **Setting up a year (B-416, D-81, D-87):** redrawn from the job, steps dragged on the year and typed as dates, kept in step; no line of steps at the top right. **The sidebar's foot (B-415, D-82):** research what belongs there (help, the company, what's new, storage…) and draw the one that earns its place, or argue for leaving it empty. **Competencies (B-417, D-86):** a small clean mark in empty cells; pick where expectations come from (drafted from jobs, written, a file) and draw it. Publish from the 2026-11-10 account; answers in a db doc `ending/main`; snapshot answers to `plans/B-412-ending.answers.json` when recording. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Apply D-32 colours | B-370 | medium | `Frontend/packages/ds/src/styles/tokens.css` light and dark per D-32 (values in the decision; the study's tokens in `plans/B-397-colour.html`), then a pass over surfaces that hard-code tones (bands, sidebar, the person page hero) so the hero and the page share one tone. Visual-only: no tests beyond the hook; screens only if asked. |
| 4+ | Performance's slices 1–13 | B-405–B-411, B-392, B-389, B-414–B-417 | per slice | One row of `plans/B-390-slices.md` per session, in its order; slices 1–10 don't wait for 3e, 11–13 do. Slice 1 (the frame) after row 3's colours. Port the explorers' drawings literally (memory `port-accepted-drawings-closely`). |
