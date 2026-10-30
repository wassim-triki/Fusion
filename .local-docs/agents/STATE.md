# STATE — live handoff

Lets any agent resume mid-task. Update after each step. When done: log to `LOG.md`, close the item (○) or send it to In review per the review gate in `AGENTS.md`, reset these sections to None, and update `Last finished`. Accounts and seed scripts: `data/`.

**Last finished:** 2026-10-30: ✓ B-162 one choice-control family. 2026-10-29: ✓ B-156, ✓ B-106, ✓ B-002. Earlier today: ○ B-158, ○ B-161, ○ B-160, ○ B-159, ○ B-157; ✓ B-155, ✓ B-154, ✓ B-153, ✓ B-152, ○ B-151, ○ B-150, ✓ B-127. The B-104 hand pass still waits on the user.

## Active work

**B-164** The tenant experience, rebuilt from first principles (Core HR deepest, Performance at its seams). [plan](plans/B-164-tenant-experience-overhaul.md)

## Goal

A coherent, design-first tenant product from the administrator's first sign-in to everyday use by every role, ready for the product tour (B-090). Platform admin out.

## Plan & progress

1. [x] Initiative captured: plan, board (B-164 with B-165 map, B-163 target, B-166 explorer and decisions, B-167 rebuild; B-090 tour after it). 2026-10-30.
2. [x] **B-165 Map** (closed 2026-10-30 after checkpoint 1): walk the journey live from an empty tenant (create it through the platform API with a `data/` script), then Carthage · Fresh and · Mid-year as each persona; per surface: route, owner, job, entry points, gating permissions, states, entities and endpoints, overlaps and handoffs; plus the Core domain model, the role/permission model and the seams. Output `plans/B-164-map.md`. No verdicts.
3. [x] **B-163 Target and scope** (accepted 2026-10-30 after checkpoint 2): brief `plans/B-164-target-brief.md`, scope settled in its §6b; scope page [artifact](https://claude.ai/artifact/CTXpeSfmikCXD3KdjLt9o4) (source `plans/B-164-scope.html`, renamed from B-163; republish with `url`).
4. [ ] **B-166 Explorer** artifact → user's verdict → decisions document. **Started 2026-10-30 (fresh session):**
   - [x] a. Reference screens: `data/screens-b166-reference.cjs` → `plans/B-166-screens/reference/` (Mid-year, dark 1440×900): 17 shots; the objective drawer didn't open (no link found), My Plan stands in for it.
   - [x] b. Real data for the mocks: `data/read-b166-carthage.cjs` → `plans/B-166-screens/carthage.local.json` (local). No one has a photo (initials in identity hues). Aicha: CDG-027, QA Automation Engineer, Consulting A Core, Ariana, since 15 Dec 2021, manager Mariam Gharbi since 11 Oct 2023; FY2027 objectives: Automate the regression suite (at risk), Make estimates clients can rely on (48%), Build role-relevant technical capability. Tarek Ayari's 4-year anniversary is 31 Oct.
   - [x] c. Style frame, **checkpoint 3a closed 2026-10-30**: [artifact](https://claude.ai/artifact/NzayZdgpvuCE3oUQk5s2CH) (source `plans/B-166-explorer.html`, version 5; db doc `explorer/main`). Person page and brand studio accepted first time; Home took five drafts and v5 was accepted ("sure, close it"). D-01–D-09 in `plans/B-166-decisions.md`.
   - [ ] d. **Next, in a fresh session:** the whole journey on the same page (cold pickup below).
5. [ ] B-167 Rebuild slices, sized after decisions.

## Decisions & reasoning

- Order: thin map → independent target → audit as the diff. Auditing first anchors on what exists; researching blind re-invents what's sound and misses constraints.
- Performance internals aren't reopened (B-065 rebuilt them; B-104 hand pass pending); only seams and gaps. Colleague modules: navigation slot and not breaking only.
- B-090 tour follows B-164; B-111 landing page stays separate.
- Scoping (user pushback 2026-10-30, they fear a closed set of research specs): intake of intent first; wide long list (EY asks, adjacent SaaS, user wishes); a depth ladder per feature (0–3), agent recommends, user picks; business value is the agent's case, demo value the user's call; a few heroes at rung 3, the rest clean at 2, a visible "not doing" list. Scope page (cheap, no screens) before the explorer (screens for chosen scope only).
- B-110 configurability moved under B-164 as a hero candidate (user: "a core wow factor").

- No intake from the user (2026-10-30): they're new to HR and have no product intent beyond configurability, useful wow factors, a Core HR "just enough but rich" with a handoff to Performance; payroll, benefits, time off out by default. The agent derives the demo story and decides format and interaction; pages open with recommendations preselected.

- Not dumbed down to a demo story: a real HRIS whose design explains itself (the tour comes after). Time is not a constraint; never size by the demo date. The report's study of existing solutions isn't drafted; research covers the well-known HRIS products and marks every feature parity / improvement / new. The user's lists are examples, not rules. Questions in context are welcome; process stays with the agent.

- Roadmap with checkpoints agreed (plan › Roadmap and checkpoints): checkpoint 1 after the map is a short chat review to catch gaps early; each checkpoint opens with where we are on the table.

## Where it stands

**Checkpoint 3a closed (2026-10-30).** The feel is settled by three accepted screens: Aicha's person page (D-01), the brand studio (D-02) and Home on day one, v5 (D-09); taste picks D-03–D-08. Committed with the B-164 working notes. No product code changed.

**Cold pickup for step d (the whole journey):**
- Read `plans/B-166-decisions.md` first (D-01–D-09 are the language), then `plans/B-166-design-direction.md`, brief `plans/B-164-target-brief.md` (§5 journey, §6b settled scope wins), map `plans/B-164-map.md` (§3: every surface gets a verdict), and memories `vibecode-tells-tinted-hero-cards` (refine the liked version, no steppers or tinted hero cards) and `person-pages-lively-not-document`.
- Extend `plans/B-166-explorer.html` (republish from that path; this session's helpers and reference captures are in the old scratchpad, not needed). Keep the three accepted anchors as they are. Add stages: day one continued (activation with "do you work here", the import's review as a chart, invitations, roles), HR every day (Core HR front page, People, changes and approvals, reports), managers (one Team page with Coming up), employees (their page, directory, org chart), over time (the organisation with its time slider), plus the everyday Home in v5's language. Each new surface type: capture 2–3 real references first, draw from the accepted anchors' grammar, verdict on every touched surface with parity / improvement / new, mark the tour moments, taste questions with recommendations preselected.
- Data: `data/read-b166-carthage.cjs` (rerun for `plans/B-166-screens/carthage.local.json`), references `data/screens-b166-reference.cjs`.
- Checkpoint 3 (the user's verdicts on all stages) completes `plans/B-166-decisions.md`, the only authority for B-167.

## Open questions & blockers

None.
