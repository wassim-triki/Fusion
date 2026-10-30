# B-164 — The tenant experience, rebuilt from first principles

**Status:** Shaped 2026-10-30. Stage 1 (the [map](B-164-map.md)) done and checkpoint 1 answered the same day. Stage 2 delivered that night: the [target brief](B-164-target-brief.md) and the [scope page](https://claude.ai/artifact/CTXpeSfmikCXD3KdjLt9o4) (`B-164-scope.html`). Checkpoint 2 answered and settled the next morning (brief §6b). Stage 3, the screens explorer (B-166), is next.

## Outcome

One coherent, design-first product from the moment a new tenant's administrator first signs in to everyday use by every role: what's there makes sense on its own and together, explains itself through its design, nothing reads as CRUD or vibe-coded, and any part of it can be demoed or walked by the product tour (B-090) without apology. Core HR gets the deepest rework; Performance is checked at its seams with Core and the shell.

**Visual bar:** BambooHR's friendliness and clean layouts (and HiBob, Personio), on Fusion's DS and `DESIGN.md`. Not newspaper density, not admin CRUD.

## Why (the user, 2026-10-30)

- Core HR was built without specs: EY gave features and examples, never a definition of what Core HR is, how a company's org and people get in, or who sees what. It was winged until it worked, then left once structures, people and accounts existed.
- It can be demoed, but there are surfaces to remove, merge, enhance, re-architect and above all redesign. A lot of Core HR feels dated.
- A seamless product tour needs cleanly engineered, clearly presented features first.
- The model to repeat is the Performance rework (B-065): first-principles research, recommendations on what's needed, overkill and wow, an interactive artifact to see the product before building it, taste questions only.

## Scope

**The journey:** a tenant administrator's invite and first sign-in → the empty tenant's first run → company setup → organization (structure, import, org chart) → people (import, hire, records, changes, leaving) → access (inviting people, administrators, roles and permissions) → everyday use by role (Home, profile, directory, team, notifications, settings) → Performance's dependence on Core (population, managers, person pages) and moving between modules.

**Depth:**
- Product and experience (what exists, what should, IA, flows, first-run and empty states, visual design): full depth.
- Domain and contracts: wherever a target surface needs them (e.g. jobs/positions, locations, documents, custom fields).
- Auth and permissions: as a role model (who the personas are, what each sees and can do, how access is granted), not a security re-audit; security gaps found on the way go on the board.
- Frontend architecture (MFEs, routing): where it shapes seams, such as one person page, one team view, one settings model.

**Tenant configurability is in** (B-110, moved under B-164 on 2026-10-30): branding and internal configuration. User: "I really wanna establish it as a core wow factor"; EY discussed it a lot but never gave specs or a depth, and the user had given up on it. Its depth is set with the ladders below.

**Colleagues' modules are no longer a constraint** (user, 2026-10-30, a signal, not a rule): the internship ended, the project lives on the user's fork, and there's no coordination with colleagues or EY anymore. Recruitment, Interview, Learning and Onboarding aren't redesigned here, but the target may hide, replace or ignore them in the tenant experience when that's right for the product (onboarding, for one, sits right next to Core HR). Until a decision says so, they keep working as they are.

**Out:** the platform administrator (except the invite that starts the journey); Performance internals rebuilt under B-065 (their hand pass is B-104); the public landing page stays B-111.

## What the user knows they want (2026-10-30)

The user is new to HR and HRIS and has no product intent to give beyond this; the agent derives the rest (the demo story included) from research and the user reacts. What they list are examples and signals, not rules.
- Configurability as a wow factor (B-110).
- Wow factors in general, but each one an actual, useful answer to a business need.
- Core HR "just enough, but actually rich", with a real handoff to Performance. Not a full HRIS: some areas are too deep for us (the user's examples: payroll, time off). Research decides which; whatever is cut sits on the visible "not doing" list, and a thin slice can still be proposed as a rung.
- The spine built so far (structure → people → accounts → Performance) is the same one established products use; it's the experience on top of it that's in question, and visually most of all.

**A real HRIS that explains itself.** The final audience is a graduation jury, technical and not, but the product is not dumbed down to a demo story (user: "let's not dumb it down, but actually let the design be self-explanatory and the application be self-explanatory"). The bar is a real HRIS whose design makes each screen's job obvious without a guide; a coherent journey follows from that. The product tour (B-090) comes after this overhaul, on top of a product that already reads on its own.

**Time is not the constraint.** Code is generated fast; scope is set by what's right, never by the demo date (user: "stop caring about the demo timeline"). Don't ask for dates or size rungs by time.

**The graduation report.** The user's report will have a study of existing solutions (not drafted yet; likely the obvious, well-known HRIS products) and how Fusion builds on, changes or improves them (the AI-assisted import is the precedent). So the research doubles as report material: it covers the canonical, famous products, and for every feature the brief and the scope page record how they do it and what Fusion does: **parity** (same as them, done well), **improvement** (better, and why) or **new** (no one does it). Improvements are the wow candidates; copying what exists is not the goal.

**Format and interaction are the agent's call** (user: "you decide on the format … keep that to you"); don't explain process to the user. The working documents (map, brief, decisions) are for agents; the user sees two pages, the scope page and the explorer, each opening with the agent's recommendation already chosen. Questions are part of the method, not a cost: the user can't dump everything up front, and a well-placed question in context (in a page or in chat, with options) is what surfaces what they think. Ask them where a call is taste or where a reaction would change the plan.

## How scope is set (user, 2026-10-30)

The user's worry: a closed set of specs from research that they get stuck inside, when the right version may hold things from outside it. Business sense and demoability both have to hold. So:
- **Wide before narrow.** The long list is deliberately open: established HRIS products, adjacent SaaS for patterns (configuration and branding in Stripe, Notion, Linear, Airtable), Fusion-specific ideas, whatever EY asked for in meetings (signal even without specs), and the user's own wishes. Nothing is dropped without being shown with its reason; the user can add an item at any time and it gets the same treatment.
- **A depth ladder per feature.** How far to take it is a choice of rung: 0 not built · 1 works, minimal · 2 what established products do · 3 showcase, beyond them. Each rung has its cost and what it shows; the agent recommends a rung, the user picks.
- **Two lenses.** Business value (would a customer miss it, does it solve a real HR problem) is the agent's case from research; demo value (do we want to show it off) is the user's call. A few **heroes** go to rung 3, the rest of the core sits clean at rung 2, the rest is cut on a visible "not doing" list the user can pull from.
- **Demo only what's real.** A showcased feature works end to end on real data and solves a real problem; no demo-only surfaces.

## Method and order

The question was audit first or research first. Neither alone:
- **Audit first** anchors on what exists: you end up grading screens instead of asking whether they should exist.
- **Research first, blind,** designs in a vacuum: it re-invents what's already sound (the temporal workforce model, the import platform, the org chart) and misses real constraints.

So: a thin **map** of what is (no verdicts) → a **target** from first principles, written without leaning on the map → the **audit is the diff** between them, shown in one interactive explorer → decisions → rebuild → tour.

| Stage | Item | Output | Size |
| --- | --- | --- | --- |
| 0. Shape | B-164 | This conversation: the user's brain dump organised into this plan (the roadmap). Nothing is started until the user says so. | in conversation |
| 1. Map | B-165 | `plans/B-164-map.md`: every tenant surface per role and state, the domain and role models as built, the Core ↔ Performance ↔ shell seams. Facts and open questions only. | 1 session |
| 2. Target | B-163 | `plans/B-164-target-brief.md` (what Core HR is in BambooHR, HiBob, Personio, Rippling, Factorial, Workday; personas; IA; a company's first run) and the **scope page**, an artifact: the wide long list, each feature with its ladder, business case, demo value, cost and recommended rung, the proposed heroes and the "not doing" list. The user picks rungs, adds, pulls back. Cheap and wide: no screens yet. | 1 session |
| 3. Explorer | B-166 | One artifact for the chosen scope only: journey stage × persona, target surfaces mocked in Fusion's look, a verdict on every existing surface (keep, redesign, merge, remove) and every missing one (build) with its reason, the tour moments, taste questions. The user's verdict becomes `plans/B-166-decisions.md` (D-IDs), the only authority. | 1–2 sessions |
| 4. Rebuild | B-167 | Slices in dependency order, each end to end (domain, contracts, UI in every state, tests), canvas first for taste-heavy surfaces, screens at the end of each. Split into children once decisions are accepted. | sized after 3 |
| 5. Tour | B-090 | The product tour walks the finished journey; its storyline is the explorer's journey. | after 4 |

## Roadmap and checkpoints (agreed 2026-10-30)

The user wants to see where this is going at all times, without the process explained to them. Every checkpoint opens with where we are on this table.

| # | Agent works | Checkpoint with the user |
| --- | --- | --- |
| 1 | Map what exists (B-165) | **1, short, in chat:** what exists, the problems seen, the questions raised; the user flags what's missing or hated. Catches gaps early. |
| 2 | Target research and the scope page (B-163) | **2, the big back-and-forth:** scope page, picks preselected, iterate until scope is settled. |
| 3 | The journey's screens (B-166), drawn to [the design direction](B-166-design-direction.md) | **3a, quick:** a style frame of three anchor screens: is this the feel? **3:** screens page, taste questions, verdicts → decisions document. |
| 4 | Rebuild slices (B-167) | After each slice: screenshots of the real screens. |
| 5 | Product tour (B-090) | Its own review. |

## Roles

- **Agent:** decides product, HRIS model, surface architecture, contracts and implementation from research and first principles, with reasons; flags existing code that contradicts a decision, never silently keeps it.
- **User:** picks add-ons and wow features from recommendations, makes taste and priority calls, accepts or rejects in the explorer.

## Authority

1. `plans/B-166-decisions.md` once accepted. 2. Approved product contracts and `DESIGN.md`. 3. Research (the target brief) is input. 4. Existing code is evidence of what exists, not authority.

## Checkpoint 1 (user, 2026-10-30)

- **Hates:** how cluttered and coupled it feels; "almost every surface speaks its own language and has its own design", and the design choices and wording read as vibe-coded. So the rebuild's first rule is one language and one design across every surface, and less coupling between them.
- **Keep:** the people org chart (the newest, liked most) and the older structure chart ("not bad"). Build on them, don't redesign them.
- **Rework:** the AI-assisted import is "a half successful attempt" that "feels so clunky". It's the improvement the report cites, so it gets a real rework, not a polish.
- The user then left the agent to continue on its own (research and the scope page overnight).

## Checkpoint 2 (user, 2026-10-30 morning)

All five questions as recommended (Make it yours shines first). Changed: C3 lists down to 1, I2 "describe a change" up to 2. Pulled back report builder, single sign-on and e-signature for discussion; the user wants reports ("a big one") and SSO for the hosted demo, and e-signature if simple. Middle rungs asked for branding, on leave and the team page; later rungs recorded (B-169). The setup guide and the product tour are one guidance system. A2 widened to the platform's roles. Resolution: brief §6b.

## The map (stage 1)

Done 2026-10-30: [B-165 tenant map](B-164-map.md). The first look before it was partly wrong: the extra performance and lifecycle addresses are redirects into the profile, and Settings is already one place with module groups. What stands is in the map's §1–§7, and its §9 lists the questions the target must answer.

## Inputs

- Earlier Core work to account for (memories): people experience reengineering, temporal workforce maintenance, workforce access activation, worker profile consolidation, org import stages and AI assistance, import on-ramp, workforce import onto the org import platform, people org chart (B-094), people changes (B-139), administrators page.
- Doctrine: `DESIGN.md`, person pages lively not document, layout from first principles, hide don't deny, loading architecture, no explanatory text.
- B-163's original ask (a general feature gap check, also feeding the assistant B-147) is folded into stage 2.

## Environment

- **Empty tenant:** a new tenant created through the platform API with its administrator invited, to walk the very first sign-in with nothing in it (a script in `data/`).
- **Carthage · Fresh** (org, people, accounts, no Performance) and **Carthage · Mid-year** (everything populated): personas Amira (tenant admin, HR, manager), Mariam (manager), Omar (manager without team view), Aicha, Leila, Khaled, Rim (employees). See `data/README.md` › Demo presets.

## Open questions

None for the user yet; questions come in context, in the pages and check-ins.
