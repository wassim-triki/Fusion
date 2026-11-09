# B-390 — Performance redesigned as a module

**Status:** shaped 2026-11-09. Stage 1 (the [map](B-390-map.md)) done. A first scope page (`B-390-scope.html`) was superseded the same day: the user wants one chapter at a time with the full Core HR system behind each, and UI choices drawn per situation rather than explained (memory `ui-decisions-shown-per-situation`). So the Fusion-wide foundation (B-397) goes first on its own page, then stage 2 is redone: a researched target brief (`B-390-target-brief.md`) and a fresh scope page. Order and recipe in STATE.

**2026-11-10:** stage 2 redone: [target brief](B-390-target-brief.md) and the scope page `B-390-scope-2.html` (https://claude.ai/artifact/VMaufYFnS2JUbPbd4xnbxm, db doc `scope/main`). **Waiting on the user's answers (checkpoint 2).** The superseded `B-390-scope.html` stays only as history.

## Outcome

Performance reads and works like the rebuilt Core HR: one design language, self-explanatory surfaces, every function working end to end. Not from the ground up: what the module does stays (B-068's decisions remain the domain authority unless a new decision changes one); its functions are cleaned up, fixed and completed (B-392, B-389), its visuals rewritten the way Core HR's were.

## Why (the user, 2026-11-09)

Core HR could demo tomorrow, Performance couldn't. At Organization direction, right after launch: "I don't think we can save this … the front end for the Performance module is absolutely garbage." Cycle setup is the exception ("something I'm proud of"): polish, not redesign. Functions and visuals are separate tracks that move together.

## Process (Core HR's, B-164)

| # | Stage | Output | Checkpoint |
| --- | --- | --- | --- |
| 1 | Map | `B-390-map.md`: code inventory + the walk + B-392 + B-389, facts and questions | folded into 2 (the walk was the live part) |
| 2 | Scope | `B-390-target-brief.md` + `B-390-scope-2.html` (the foundation went first, B-397/D-32): Performance's jobs, heroes, every feature with a 0–3 depth ladder (parity / improvement / new against Lattice, Culture Amp, Leapsome, 15Five, Betterworks, BambooHR, HiBob, Workday), not doing, questions | **2: the user answers the page** |
| 3 | Direction and explorers | a design direction for Performance on Core HR's language; explorers checkpoint by checkpoint until every screen has an accepted design; decisions recorded with new IDs after D-31 in `design/decisions.md` | 3a style frame, then per explorer |
| 4 | Rebuild | dependency-ordered slices, one session each, functions with their surfaces | screens per new surface |

## Authority

1. The user's answers on the scope page and the decisions that follow. 2. `archive/plans/B-068-decisions.md` (Performance domain, D-01–D-41) where not changed, `design/decisions.md` (Core HR's design language) and `DESIGN.md`. 3. Research is input. 4. Existing code is evidence, not authority.

## Notes

- Fusion-wide decisions (B-397) are settled in chapter 1 so Performance isn't designed on rules that change after; applying them to Core HR is B-396, Home (B-378) comes after Performance.
- The demo of a months-long year (B-395) depends on the phase answer (scope item R3).
