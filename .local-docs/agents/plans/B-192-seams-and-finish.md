# B-192 — Seams and finish (rebuild slice 18)

**Status:** Scope reviewed against slices 1–17 and agreed by the user, 2026-11-05 ("im happy with them"; the unit-level word left to the agent). Build in one fresh session at medium effort. Authority: this plan, then slice row 18 in `B-167-rebuild.md`, the brief's Q3 and X1 (rung 2: one glossary, one way to refuse, nothing shown that a role can't use), `DESIGN.md` §8. The demo presets moved out to **B-298**.

## 1. Colleague code still builds (first, it may change the rest)

The commit hook has skipped Learning, Recruitment, Interview and Onboarding since B-234, and `@repo/auth`, `@repo/api` and `@repo/ds` have changed a lot since. Run `pnpm --filter <app> type-check` and `lint` once per app, one at a time. Fix only what our shared changes broke; board anything else.

## 2. Colleague modules only when the company has them on

Today `visibleFusionModules` (`packages/api/src/fusion-navigation.ts`) shows every entry without an `entitlement`, so all four show for everyone.

- Add `Learning`, `Recruitment`, `Interview` to `TenantModule` and `ModuleEntitlements`, off by default. Platform's catalogue is built from the enum (`ProvisionableModuleCatalogue`), so they should appear there. Check on the way: Platform's provisioning and tenant product screens, `ProvisioningModuleContractTests`, and `TenantAdministratorAuthority.BuildGrants` / `ModulePermissionRegistry` with modules that contribute no permissions.
- Give the three registry entries an `entitlement`. Their `visibleFusionModules` rule for governed modules also needs "at least one workspace"; these have no such check yet, so entitlement alone decides.
- **Onboarding** leaves the registry (joining checklists replace it, B-184), with `apps/shell/src/config/constants.ts` kept in step. Its app stays in the repo.
- **Direct addresses:** the shell's middleware only sees a cookie hint, not entitlements, so the block has to run in the browser: one small shared gate from `@repo/auth`, added to each colleague app's root layout, that sends a signed-in person without the entitlement to Home. This is the shared contract the ownership rule allows; change nothing else in those apps. **Keep public:** `/learning/verify` and `/interview/candidate/start`.
- Their own APIs stay as they are. Learning keeps the token-role copy (B-178).
- Existing companies lose these from the switcher until turned on in Platform; that's the agreed default (demo tenants off).
- Tests: entitled and not, for the switcher and the gate, public routes untouched. Run `security-review` if entitlement or token code changes beyond adding the values.

## 3. Words: a fix list, not a sweep

Each slice already applied `DESIGN.md`. Fix these in EN, FR and AR, then grep the catalogues once more for the same words. Platform's own screens may say tenant.

| On screen today | Where | Becomes |
| --- | --- | --- |
| Tenant Administrator; "This tenant is administered again" | `shell` activation, journeys and terminals | Administrator; the company |
| "This tenant does not currently have the Core HR module enabled" and similar | `core/frame` boundary | the company |
| "Worker not found", "this worker", "Contact a tenant HR administrator" | `core/profile.record`, `.self` | person; HR |
| "Set up / Review workforce access" | `core/profile.record` | sign-in, matching the Access tab |
| "The canonical People value Fusion resolves workforce access against." | `core/profile.workEmail.hint` | a plain line, or remove it |
| "Worker ID" | `core/changes.start.workerId` | check whether it's shown; plain words or remove |
| "Login failed. Please try again." | `auth.signIn.failed` | "Couldn't sign you in. Try again." |
| Location (8) beside Place (60) | settings, changes, orgChart, profile | Place, unless it names something else |
| org unit (12) beside unit (166) | mostly Performance | unit |
| Company (91) and Organization (89) | across | Company is the customer; Organization is its structure |
| goal (46) beside objective (250) | Performance, shell, ds | check first: development goals are a real, separate concept; change only the ones that mean objective |

### The top-level unit word (the user left this to the agent, 2026-11-05)

The front page says "Departments" for what the org chart and Reports call "Division", and Carthage has real departments beneath them. **Decision: use the company's own level name.**

- `FrontPage.cs` already picks the level: Division if the company has any, else Department, else Reports' top-ancestor grouping. Return that level with the page, and have the front page say **Divisions**, **Departments**, or **Units** for the fallback, in `core/overview`, including "Leads {department}" and "Not in a department". The accepted grouping doesn't change, only its word.
- Org chart's lens and Reports' field read "Division" and group by top ancestor under the root, a different rule from the front page's. Keep their grouping and check what they should say for a company whose top level isn't a Division; use the same word where the level matches.
- Update `front-page.test.ts` and `people-view.test.tsx`.

## 4. One way to refuse

Still in live catalogues: "Access denied" + "This area is not available to your account" (`core/frame`), "Organization access required" (`core/organization`), "Org chart access required" (`core/orgChart`), "You do not have access to this page" (`core/wfAccess`, remove if unused, step 5), "Administration only" ×4 (`performance` cycle, cycleSetup, reviews).

One shared refusal in `@repo/ds/shell`, one line in the person's words saying who can help, used by all of them. Navigation already hides what a role can't use, so this is what a typed or old address shows. Per the permission-gate rule, gate on operational access; keep `core/organization`'s "access-denied" save error if it's a refused change rather than a page.

## 5. What replaced screens left behind

Routes are already redirects; keep those.

- Delete `apps/core/messages/*/admins.json` (156 strings per language, no user) and its entries in the message loaders.
- `wfAccess`: 67 of 239 keys have a last segment found nowhere in Core's source. Confirm key by key (dynamic keys exist), delete what's dead in all three languages.
- `core/frame`: `nav.workforceAccess`, `skeletons.accessProfiles`, `skeletons.openingAccessProfiles` if unused.
- `tenantAccessPaths` with no caller: `suspend`, `reactivate`, `invitations`, `activity`, `recentActivity`, `removedAdministrators`. Remove them, and the `TenantAccessController` actions behind them when nothing else calls them (check tests and `.local-docs/agents/data` scripts; `Roles` and history use others). Authorization code: remove with its tests, keep the rest passing.
- **Check first:** no route was found that issues a tenant administrator invitation (`IAdministratorInvitationService.IssueAsync`). If that's true, the Issue, Resend, ReplaceEmail and Revoke commands are dead. `/accept-administrator-invitation` then matters only if recovery uses it; confirm which page recovery links to, and remove what nothing reaches. Keep recovery working.
- Performance: `competency-catalog.tsx`, `rating-scale-model.ts` and its test.
- Also: the lint warning in `apps/shell/src/app/auth/sso/complete/page.test.tsx` (`import()` type annotation), and **B-242** (core's unused `@xyflow/react`, `flattenOrganizationHierarchy`).

## 6. Finish

- One walk per role through the shell on Carthage, as a script with checks (administrator, HR, manager, employee): sign-in, Home, the role's main pages, a refused address, no colleague modules in the switcher. Screens only where something looks wrong, plus one for each changed surface: the refusal, and the front page's level word.
- Once: `test-backend.ps1` for Identity, CoreHR, Performance if touched; touched apps' tests; cold `build` of the shell and any app with changed routes or layouts, including colleague layouts if the gate went in (one at a time; the frontend down first, memory).
- Ends In review: the refusal, the wording, the switcher.

## Out

Demo presets and their company finish (**B-298**), the tour (**B-090**), rate limit and DNS hardening (**B-296**, **B-297**), colleague modules' own wording and refusals.
