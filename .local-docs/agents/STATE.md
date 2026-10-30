# STATE — live handoff

Lets any agent resume mid-task. Update after each step. When done: log to `LOG.md`, close the item (○) or send it to In review per the review gate in `AGENTS.md`, reset these sections to None, and update `Last finished`. Accounts and seed scripts: `data/`.

**Last finished:** 2026-10-30: ↻ B-167 sized into 18 slices, order accepted. ✓ B-166 screens decided (D-01–D-30). ✓ B-162 one choice-control family. 2026-10-29: ✓ B-156, ✓ B-106, ✓ B-002. The B-104 hand pass still waits on the user.

## Active work

**B-175** Jobs, places and the company's lists: slice 1 of 18 of the rebuild (B-167, under B-164). [slices](plans/B-167-rebuild.md) · effort **high** · not started; first session picks up below.

## Goal

Jobs become objects (title, family, level), places a list, and the company gets its own lists (leave types, change reasons, employment types; a used value is retired, never deleted). Assignments and open roles point at a job and a place; today's free-text titles and locations are migrated; every consumer (Performance, Identity, Learning, both imports) keeps working. Screens: the job catalogue, places, Settings › Lists, and job and place pickers where titles and locations are typed today.

## Plan & progress

1. [ ] Read the cold pickup; settle the model calls under Decisions and write them there before the first edit.
2. [ ] Domain and migration (CoreHR): Job (+ family, level), Place, company lists and values; `WorkAssignment` and `OpenRole` reference job and place; employment type becomes a list value. Migration groups each tenant's distinct normalised titles into jobs and locations into places; Down restores the text.
3. [ ] Writes: every path that writes a title or location today (establish/hire, `UpdateEmployee`, the change sheet's job change, open roles, the workforce import's publish) takes a job and a place; the import resolves or creates by name until B-186 rebuilds it.
4. [ ] Reads and contracts: keep `jobTitle` / `workLocation` strings on every read DTO and the internal snapshot (Performance, Identity and Learning read them), filled from the job and place; add ids, family and level where screens need them; `@repo/api` types.
5. [ ] API and authorization: manage jobs, places and lists under Core settings/structure permissions, server-side and tenant-isolated; negatives (unauthorized, cross-tenant, retired value, duplicate name).
6. [ ] Screens: job catalogue (by family and level, people in each, merge two jobs into one), places, Settings › Lists, pickers in today's forms. Loading, error, empty; EN/FR/AR lean. Not drawn in the explorer: build in the accepted grammar (D-01, D-17), judged at review.
7. [ ] Demo data: a `data/` script that gives the Carthage presets families and levels (the migration makes jobs from titles; the script groups them), recorded in `data/README.md`.
8. [ ] Checks, once settled: `test-backend.ps1 CoreHR` (relational, Up/Down), Performance and Identity tests that touch the snapshot, an API journey through :3000, type-check `@repo/api` core performance learning shell, core lint and test, one cold core build (new routes). Screens dark 1440×900 → B-175 to In review; commit at the end.

## Decisions & reasoning

To settle in step 1 (agent's calls; recommendations from the scope page's O2 rung 2, O4 rung 1, C3 rung 1):
- **Job:** title + optional family + optional level, level being a value of a company list "Levels" (ordered). Not effective-dated: the catalogue isn't history; people's changes are. A renamed job shows its current name in history (say so in the decision).
- **Merge:** two jobs merge into one as a catalogue correction (moves references, audited), not a person change.
- **Place:** name, optional city and country. Rung 1.
- **Lists shipped:** leave types, change reasons, employment types, levels; values have a stable key and a label; no translations (C3 rung 1).
- **Where the screens sit:** Jobs and Places inside today's Organization area so B-183 (Organization in time) only reseats them; Lists under Settings' Core HR group.

## Where it stands

Not started. **Cold pickup:**
- Read `plans/B-167-rebuild.md` (rules for every slice, slice 1's row), the map `plans/B-164-map.md` §4 (domain as built) and §6 (seams), brief `plans/B-164-target-brief.md` §6–§6b (O2, O4, C3), `DESIGN.md` for the screens, memories `colleague-modules-only-must-not-break`, `aspnet-record-validation-attributes`, `prettier-reflows-whole-files`, `build-speed-mode`, `machine-memory-checks`.
- Code: `Backend/EY.HRPlatform.CoreHR/Domain/Entities/WorkAssignment.cs` (`JobTitle`, `WorkLocation`, `UpdateDetails`), `OpenRole.cs`; `Features/Workforce/Dtos/WorkforceContractsDto.cs` (`InternalWorkforceEmployeeSnapshotDto`), `Features/Workforce/Services/WorkforceCanonicalResolver.cs` and `InternalWorkforceSnapshotService.cs`; `Features/People/*` (contracts, `JobHistory`, `Changes/WorkforceChangeService`); `Features/Employees/Import/*`; `Features/OrgChart/OpenRoles.cs`; consumers `Performance/Infrastructure/Core/WorkforceSnapshotContracts.cs`, `Identity/Infrastructure/Core/CoreWorkforceDirectory.cs`.
- Reach: `JobTitle` appears in ~94 backend files (tests included), `WorkLocation` in 35, `EmploymentType` in 30; `jobTitle` in the frontend: core 34 files, performance 24, `@repo/api` 11, learning 3, shell 2, auth, performance-ui, workforce-ui 1 each. Use the C# and TypeScript language servers to follow them.
- After B-175 closes, the next slice is B-176 (brand studio) at **high**.

## Open questions & blockers

None.
