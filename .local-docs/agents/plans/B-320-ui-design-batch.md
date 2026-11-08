# B-320 UI and design batch

User 2026-11-08: "batch the most from ui and design in 1 batch without losing quality". One batch, four sessions, so no piece is rushed: drawings first (taste pieces are canvas-first), then one build session per heavy piece, the light ones together.

| Piece | What | Taste? | Session |
| --- | --- | --- | --- |
| B-198 | One tab / view-switch pattern: `LinkTabs` (`@repo/ds/shell`, person page since B-180) becomes the one pattern; every other tab strip and view switch in our apps moves to it (Organization lenses, Performance, Platform, DS). Learning's is a colleague module: leave it. | Drawn once (tabs + view switch) | 1 |
| B-228 | Performance object lists with the title inside their container: My Plan sections, the review record's sections, Feedback's request lists, the person summary's Performance parts. Recommendation: rows in one frame, rich detail in the drawer (as Needs you). | Yes | 2 |
| B-210 | Sign-in's company column: more than logo + name on a wash (user: "still lacking … the empty column"). | Yes, canvas first | 3 |
| B-201 | Places table richer (people per place, address, map-ish cue — explorer decides). | Yes | 3 |
| B-249 | Brand studio's Home preview draws the real Home (day one's guide, the company card), not the stand-in. | Little | 3 |
| B-301 | One word for "growth goal" / "development goal" across Performance (and Core HR mentions), en/fr/ar. | Wording | 3 |

Left out: B-249 (user 2026-11-08: "omit 249 for now"), B-230 (parked by the user), B-250/B-274 sidebar toggle (deferred after rejected attempts).

## Session 0: explorer
- Read `DESIGN.md`, memory (anti-vibecode, surface ladder, radius roles, section titles inside sections, port drawings closely, explorers show only new screens).
- Inventory every tab strip / view switch in core, performance, platform, shell, `@repo/ds`, `@repo/performance-ui` (grep `TabsList`, `role="tablist"`, `ToggleGroup`, `SegmentedControl`, custom strips) and screenshot-free read of the B-228 surfaces.
- One interactive artifact `plans/B-320-explorer.html` with Carthage data: the tab + view-switch pattern applied to 2–3 current uses; B-228 each surface as rows in one frame + drawer; B-210 2–3 variants; B-201 1–2 variants; B-249 noted only; B-301 the word recommended with where it appears. Recommendations preselected; taste questions only.
- No product code. Ends with the user's picks recorded here.

## Sessions 1–3
Port the accepted drawings literally; one screen per new surface (dark 1440×900); touched tests; one commit each; In review at the end of each.

## Session 0 findings (2026-11-08)
- Tabs: `LinkTabs` (address tabs, counts) and `Segmented` (`@repo/ds/choice`, same data another way) already exist with the same tint. Off-pattern: shadcn `Tabs` on Changes and approvals (`changes-page.tsx`), Feedback (`feedback-workspace.tsx`), the Organization panel's Details/History (`organization-workspace.tsx`); hand-made strips on Cycle (`cycle/page.tsx`, underline) and Calibration (`calibration-header.tsx`). Rule drawn: parts of a page = `LinkTabs`; same data / panel sections = `Segmented`. Then drop `@repo/ds` `tabs.tsx` if nothing of ours imports it.
- Lists: plan sections use `PlanSection` (title on the canvas); the review record uses `SectionHeading`. Drawn: lists you read → rows in a `Section` + drawer; the review keeps inlay items (a form).
- Sign-in: `SignInFrame` in `@repo/auth` shows logo + name on a wash. Drawn: optional welcome line (new Brand field) + a shape from the logo in the company colour; or an uploaded photo.
- Places: `places-workspace.tsx` has Place / People / Open roles; `PlaceDto` has city, country, counts. Drawn: faces, share, teams.
- Goal word: Development 21 places vs Growth 11 in English text.

## Picks (user 2026-11-08: "1, sure, 2 sure, 3 sure. 4 ok, 5 sure approved")
1. **B-198** Rule agreed: parts of a page = `LinkTabs` (address, counts); same data another way and side-panel sections = `Segmented`. Move Changes and approvals, Feedback, Cycle, Calibration, the Organization panel.
2. **B-228** Rows in one `Section` with a drawer for lists you read (My Plan objectives and development, Feedback requests, person summary); the review keeps inlay items with rating and comment inside the frame.
3. **B-210** Optional welcome line (new Settings › Brand field, Identity) + a faint shape from the logo in the company colour on the column; no photo upload.
4. **B-201** Places table with faces, share of the company (bar) and teams; no cards.
5. **B-301** "Development goal" everywhere (en/fr/ar: objectif de développement, هدف تطوير).
Explorer: `plans/B-320-explorer.html`; port it closely.
