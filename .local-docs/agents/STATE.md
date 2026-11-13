# STATE - live handoff

**Last finished:** the redraws explorer (queue row 4), 2026-11-13: picks recorded as D-103 to D-109, builds queued as rows 5 to 8 (LOG). Before it: the review page made clear (queue row 3), accepted.

## Active work

None.

## Next

Session queue (the user opens a fresh session with "next"): it takes the first open row, deletes the row when committed, sets it as Active work and moves its items to In progress. Each row is one session, one agent, one commit (code + board), medium effort unless noted; the commit's last message is the next row's prompt. Free memory yourself when a job (the commit hook too) is refused: stop the frontend, run it, restart only when the next step needs it.

**How the user wants this work done (2026-11-13):** fast but clean; bugs before redraws; a redraw is an explorer first (drawn variants, labels not paragraphs, the user picks), then a build session that ports it literally. Feel: warm and friendly like BambooHR and Upwork. Every action says what happens before the click and confirms after (memory `actions-say-what-happens`). Memories: `ui-decisions-shown-per-situation`, `redesigns-bold-not-tweaks`, `port-accepted-drawings-closely`. D-95 holds everywhere.

| # | Session | Board items | Notes |
|---|---|---|---|
| 5 | Build: setting up a year | B-466 with B-467, B-468 | D-103, D-104 (D-102's year bar goes). Port `plans/B-466-redraws.html` › Setting up a year (variant a for the dates, a for who's in); who's in needs Core HR's employment type and leave for the rules, check what Core HR holds first. One screen compared with the drawing. |
| 6 | Build: the Year's next step | B-453 | D-105 to D-107. Port › The Year's next step (a, a); nudges carry a bell. |
| 7 | Build: one goal drawer | B-451 | D-108 (the progress dialog goes). Port › One goal drawer (a); the original updates list is in git at `d935d5b2^` (`progress-history-timeline.tsx`). |
| 8 | Build: a team member's plan as a wide panel | B-450 | D-109. Port › A plan, before deciding (b), parts reusable for a plan page. |
| 9 | Home rework | B-378 | Research brief, long list, explorer (memory `scope-with-depth-ladders`), then build. |
| 10 | The demo in two acts | B-395 | `lateyear` preset + "meanwhile" script, rehearsal, screens; shows a little of the HR side (questions, competencies, scale). Near the jury date. |

Still In review (the user's verdicts land as Ready children): B-405, B-424, B-431, B-434, B-440/B-446, B-447, and the shared pieces B-456, B-449. Ready leftovers: B-442, B-443, B-444, B-448, B-469.
