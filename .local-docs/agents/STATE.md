# STATE - live handoff

**Last finished:** session 2 after the walkthrough, 2026-11-09: B-390's map (`plans/B-390-map.md`) and a first scope page, then redirected by the user (see Next, row 3). Before that, session 1: B-398, B-391, B-399's administrator floor and own-role sign-out, B-400, B-401; all closed ○ in LOG.

## Active work

**Row 1, the Fusion-wide foundation page** (B-397), 2026-11-09, same session at the user's word ("do it here"). Round 1 (29 situations as thumbnails, https://claude.ai/artifact/Kq91ddwjiTPb4BrEEVzCLF) answered and judged too shallow; its outcome and the rules the agent settles itself are in `plans/B-397-foundation.md`. **Round 2, the full-size colour study, published and waiting on the user:** https://claude.ai/artifact/32F5aE6EBg3yyGpS56bWYj (`plans/B-397-colour.html`, db doc `colour/main`, empty at publish). After it: record colour as a decision (D-32), then Performance's scope (row 3), whose first full-size screens settle the remaining visual rules (empty states, panels, navigation, type) in context. Feel: warm and friendly like BambooHR and Upwork.

## Next

Session queue: a fresh session takes the first open row, sets it as Active work and moves its items to In progress. Each row is one session, one commit, everything it needs referenced on the board.

**The user's verdict on the first scope page (2026-11-09):** one chapter at a time, each built with the full Core HR system (B-164: research brief, open long list, then the page) and a session's whole effort. On UI decisions: too much text; draw the variants and let them speak; and no universal answer per topic: decide per situation (an empty section in a record isn't an empty module's first run), consistent within each situation across modules. Memory: `ui-decisions-shown-per-situation`. The published page (https://claude.ai/artifact/HPYdcFF8oMe1zbCW652sq4, `plans/B-390-scope.html`) is superseded: chapter 1 is redone as its own page (row 1), chapter 2 later (row 3). Don't ask the user to answer it.

| # | Session | Board items | Effort | Notes |
|---|---|---|---|---|
| 1 | Fusion-wide foundation, decided per situation (page published, waiting on the user) | B-397's foundation and decisions: B-370 colours, B-376 empty states, B-379 loading shapes, B-393 icons, B-381 navigation, B-338 your menu, B-373 detail panels, type (B-377's serif titles), with B-347, B-382, B-394 as rules | high | No code. Recipe below. Stops at the user's checkpoint. |
| 2 | Core HR functions | the rest of B-399: root rename, a promotion to a missing job (say why, offer to add the job), a change effective today, leave on a chosen date in the chart, Reports' date range, People sorting and the Manager cell, Replay speed | medium | Can run while the user answers row 1. Replay speed may need its own session if profiling shows it's large; split then, not before. |
| 3 | Performance target brief and scope | B-390 | high | After row 1's checkpoint. Map exists (`plans/B-390-map.md`). Redo stage 2 the Core HR way: a researched target brief (`plans/B-390-target-brief.md`: Lattice, Culture Amp, Leapsome, 15Five, Betterworks, HiBob, BambooHR, Workday; personas; IA from first principles; a wide long list beyond what exists, each feature parity / improvement / new) like `archive/plans/B-164-target-brief.md`, then a fresh scope page from it (ladders, heroes, not doing, questions), drawn where a choice is visual, labels not paragraphs. The first page's chapter 2 is a draft to mine, not a base. |
| 4+ | Performance design, then its slices | B-390 | high for the direction and explorers | After row 3's checkpoint: design direction on Core HR's language and row 1's decisions, explorers per checkpoint, decisions (IDs after D-31 in `design/decisions.md`), then slices sized to fill a session each. |

### Row 1 recipe: the foundation page

1. **Inventory situations from the code, per topic.** Where each thing occurs across our apps (shell, core, performance, platform, `@repo/ds`), grouped into situations, each with 2–4 real examples. Starting list, to correct from the code:
   - Colours: canvas, section, card, inlay, overlay per page type (record with band, workspace or list, settings, hub/Home, flows like setup and the import), light and dark.
   - Empty states: a module or page's first run (nothing yet, you can start it); an empty section inside a record (About, Performance on a new person); an empty list or view (Starting soon, Waiting approvals); no results after a search or filter; a chart or period with no data; not yet (no cycle started) or not for you; waiting on someone else.
   - Loading: a page's first load; switching a tab or view; refreshing in place; an action in progress (a button, a save); long work (the import, AI drafting).
   - Icons: the set and its style across navigation, buttons, statuses, empty states.
   - Navigation: the sidebar's structure, depth inside records (breadcrumbs, back), moving across modules and into Settings.
   - Your menu: the top bar in its states.
   - Details: quick look, edit, create, confirm (panel, page, modal, inline) per situation.
   - Type: page titles, record names, section titles, labels.
2. **Research per situation**, lightly and with real sources: how BambooHR, HiBob, Personio, Lattice, Linear, Notion, Stripe handle that same situation. Record it in `plans/B-397-foundation.md` with the inventory.
3. **The page** (`plans/B-397-foundation.html`, artifact with `db`, the B-164 scope page's save and copy mechanics): per situation a name, one line of where it occurs (real examples), and 2–3 variants **drawn** in Fusion's real look (tokens from `Frontend/packages/ds/src/styles/tokens.css`, Geist, Lora for the serif, real Carthage content and the walk's real cases), dark and light where colour matters; my pick preselected; a note box. No paragraphs. Rules (B-347 no em dashes and no dot-strung stat lines, B-382 photos, B-394 optimistic updates, disabled buttons say why on the page) as a short list kept unless objected.
4. Stop at the checkpoint; record the answers as decisions (IDs after D-31 in `design/decisions.md`) in the session that reads them.
