# STATE — live handoff

Lets any agent resume mid-task. Update after each step. When done: log to `LOG.md`, close the item (○) or send it to In review per the review gate in `AGENTS.md`, reset these sections to None, and update `Last finished`. Accounts and seed scripts: `data/`.

**Last finished:** 2026-10-30: ✓ B-176 brand studio accepted (slice 2 of 18). Earlier: ✓ B-175 jobs, places and lists; ↻ B-167 sized into 18 slices; ✓ B-166 screens decided. The B-104 hand pass still waits on the user.

## Active work

**B-177 — one roles model** (slice 3 of 18, B-167), started 2026-10-30, xhigh.

## Goal

D-25 end to end: a role = ten plain areas × level × reach; holders = everyone, anyone with a team, self-updating rules (department, job, place, unit), chosen people; a person's roles with why. Screens: every role as one table, a role page in sentences with a live preview of a real person's page. Replaces Settings › Roles. Security-review; authz + cross-tenant negatives; rule recompute on job/unit change.

## Plan & progress

1. [x] Read the existing model (access profiles, grants, catalogue, token, scopes, Settings › Roles).
2. [x] Settle model calls (below).
3. [x] Backend: Identity (RoleAreas, templates, holders, recompute worker, roles endpoints, migration AddRoleHolders) and Core HR (role-facts endpoint, change interceptor + notifier); tests written. Carthage adopted on restart: Employees 24 (everyone), Managers 9 (team), HR chosen.
4. [x] Frontend: `features/settings/roles/` (table, role page, preview, person roles, model + test), routes `/settings/roles` and `/settings/roles/[roleId]`, Access tab roles, change history on cells; old `sections/roles.tsx` removed; core type-check clean, touched tests pass.
5a. [x] Journey `data/journey-b177-roles.cjs` 30/30 (incl. rule recompute on a Core HR job change and its cancel); screens `plans/B-177-screens/` (01–06); Identity 552/0/0, Core HR 611/0/5; core tests touched pass.
5b. [x] security-review: found and fixed a pre-existing escalation: an invitation could carry the Tenant Administrator definition (bulk invite's explicit profile or the provisioning default), and accepting it granted every administrator permission. Now invitations refuse it (and retired Org Admin), and effective permissions count the definition only through the canonical assignment. Tests added.
5c. [x] Docs: LOG (→ In review), BACKLOG (B-177 In review; B-212–B-214 boarded; notes on B-179, B-189), `plans/B-177-roles.md` checklist, data README.
5d. [ ] Cold build of core (running), retake screens 01/02, commit (3 commits: backend, frontend, docs), reset STATE, next prompt.
5. [ ] security-review, checks, screens, In review, commit, next prompt.

## Decisions & reasoning

- **M1 Areas are a SharedKernel contract** (`RoleAreas`): ten areas, each a list of options (level, reach) with *defining* keys and *companion* keys over the existing catalogue. A role's cell = the highest option whose defining keys it holds (scope rank ≥); saving composes defining + companions of each cell, plus every held key no area owns (legacy, colleague-module settings). What the editor shows is exactly what gets saved. The client gets the table from the API (one source of truth in C#).
- **M2 Mapping:** Jobs (see self/team/everyone = `core.employee.view`@S/DR/T, +`core.team.view` for team; change everyone = `core.employee.manage` + view, reporting, import). Personal (see/change themselves = `core.profile.self.*`; for others it is *linked* to Jobs: Core HR's one record read/edit carries both today, so see team/everyone and change everyone share Jobs' defining keys and the editor shows them moving together; unlinking waits for B-180/B-181's Personal sections and field audiences → board). Organization (see = `core.orgchart.view`@T; change = `core.organization.manage` + view, setup, structure settings). Approving changes (propose team / approve everyone: new keys `core.change.propose`@DR, `core.change.approve`@T, stored now, enforced by B-179). Reports (see everyone = `core.overview.view` + `settings.governance.view`; build and team come with B-189). Invitations and sign-in (see = `core.access.view` + provisioning view; change = + manage). Plans and check-ins (see/change themselves = `performance.cycle.view`@Self / + `objective.self.manage`; change team = `cycle.view`@DR + `objective.org.manage` + `organization.view`; see everyone = `cycle.view`@T). Cycles and calibration (see = `performance.settings.view` + cycle view@T; change = `cycle.manage` + strategy, calibrate, settings manage, org objectives). Brand, fields and lists (`settings.organization.*`, `settings.peopleData.*`, legacy `core.settings.*`) and Roles (`access.profiles.*`, `access.assignments.*`, legacy `core.accessprofiles.manage`) are **Administrators only**: refused on any other role, stripped from existing ones by a migration (HR loses the administrators page and Employee fields view: tighter, and D-25 as drawn).
- **M3 Reach "their unit" is not offered yet**: no Core HR or Performance read resolves the viewer's unit today (only `cycle.view@OrgUnit`, unseeded and treated as team). Offering it would be a lie → board item; deviation named at review.
- **M4 Holders:** a role has one holder kind (chosen people only, everyone, anyone with a team, a rule) plus chosen people (not for everyone). A rule = conditions on department, job, place or unit (OR within a kind, AND across kinds); department and unit match the person's unit or any unit above it. Stored: `AccessProfiles.HolderKind` + `AccessProfileRuleConditions`; `UserAccessProfiles` keeps one row per person and role with `IsChosen` and `ByRule` (row exists while either holds), so tokens, eligibility and permission holders read the same rows as today. Everyone = every active member bound to a person.
- **M5 Recompute:** Identity evaluates rules against Core HR facts (new signed internal `role-facts`: unit chain with types, job, place, direct reports), per tenant. Triggers: a role's holders saved (inline), Core HR saving a work assignment, manager line, employment or unit (Core HR posts a signed recompute after commit, queued with retry), invitation accepted, Identity start-up and every 6 hours (dated changes). Core HR unreachable → rows kept, retried.
- **M6 Seeded roles:** Employees (everyone), Managers (anyone with a team), HR (chosen; was HR Admin), Administrators (canonical, protected, unchanged authority). Templates are written in area cells. Org Admin is no longer seeded and is removed where nobody holds it (nobody does locally); its compatibility coverage stays frozen for the token roles until B-178 retires them.
- **M7 A person's roles with why:** `GET core-access/people/{employeeId}/roles` → each role with reasons (everyone, has a team, which rule conditions, chosen, administrator); shown on the person's Access tab.
- **M9 Chosen people are accounts** (user ids), so an account without a person record that holds a role is kept on save (found on HR in Carthage).
- **M10 Access tab** lists roles with why; the old "Manager access/Employee access" line (token role) is dropped since it contradicted the roles.
- **M8 Screens:** `/core/settings/roles` = every role as one table (areas × roles, level and reach per cell, holders in the header, Administrators locked); `/core/settings/roles/{id}` = holders editor, what it can do as sentences, live preview of a real person's page as one of its holders would see it with this role. Role changes reach a signed-in person at their next token refresh (≤ 60 min), as today.

## Where it stands

None. Next slice: B-177 (one roles model) at **xhigh**, in a fresh session; prompt in the last handover. Carthage keeps the B-176 brand (blue, a test logo, English) for the review; `journey-b176-brand.cjs` without `--keep` puts it back.

## Open questions & blockers

None.
