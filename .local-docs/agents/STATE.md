# STATE - live handoff

**Last finished:** B-331 manual walkthrough, 2026-11-09: a new company walked from the administrator's invitation to a released review; findings under B-331 in Ready (one item per surface, verbatim notes in `plans/B-331-walkthrough.md`).

## Active work

None.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Who you are and what you hold | B-398 (Managers role security check, B-391 import's dropped reporting lines), from B-399: the administrator floor of one and your own role change signing you out; B-400 one person one account; B-401 land on Home after accepting | high | Auth and tenant data: `security-review` skill; journeys with negatives; relational suite for CoreHR and Identity; prove B-391 by re-importing the walkthrough files into a fresh company (`data/start-walkthrough-company.mjs`, `data/make-walkthrough-import-files.mjs`). |
| 2 | Performance map and scope | B-390 (process in its item: map → scope page with depth ladders → stops at the user's checkpoint) | high | No code. Map = code inventory + the B-331 walk (`plans/B-331-walkthrough.md` §7) + B-392 + B-389; scope as an artifact like `archive/plans/B-164-scope.html`. Its first chapter lists the Fusion-wide decisions (B-397) to settle. |
| 3 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Runs while the user answers session 2's checkpoint. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 4+ | Performance design, then its slices | B-390 | set at session 2's checkpoint | Explorers per checkpoint, decisions, then slices sized to fill a session each. |

