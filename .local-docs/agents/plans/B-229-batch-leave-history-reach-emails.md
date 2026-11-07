# Batch: On leave (B-229), Access › History (B-231), "their unit" reach (B-212), branded notification emails (B-204)

## Context
Four ready board items that all deepen the person record and who-sees-what, chosen by the user to run as one batch:
- **B-229 On leave**: a person can be on leave (type from the company's Leave types list, from/until), shown wherever the person appears, Performance included (P5 in `plans/B-164-target-brief.md`: Performance does not pause tasks).
- **B-231 Access › History**: the account story on the person's Access tab (invited by, delivered/failed, resent, withdrawn, accepted, last signed in). B-180 left the drawn History waiting on this.
- **B-212 Their unit**: roles can reach "their unit" (the holder's unit and the units under it), as D-25 drew; today `OrgUnit` scope exists but ranks like DirectReports and is treated as a team, so the roles UI doesn't offer it.
- **B-204 Branded notification emails**: Core HR and Performance emails carry the company's name, colour and logo like Identity's invitations (B-176).

No drawings exist for On leave or Access › History (B-180 notes them as "not drawn"), so the batch opens with one explorer, then builds.

**Decided with the user (2026-11-07):** explorer first; then three builds, one commit each. Each session runs fresh, per AGENTS.md (STATE.md holds the cold-pickup recipe). On approval: set the batch as Active work in STATE.md, move B-229/B-231/B-212/B-204 to In progress under one parent line, and run Session 0.

## What exists (reuse)
- Leave types: `CompanyListKind.LeaveTypes` in `Backend/EY.HRPlatform.CoreHR/Domain/Entities/CompanyListValue.cs`, served by `CompanyListService`; frontend `useCompanyLists()` (list id pattern as `employment-types`).
- Dated changes: `WorkforceChangeKind { Join, JobChange, EndEmployment }` + Scheduled/InEffect/Cancelled in `Domain/Entities/WorkforceChange.cs`; `WorkforceChangeService`/`WorkforceChangeRecorder`, `ChangeDrafter`, change requests (approvals) and the change panel `Frontend/apps/core/src/features/people/changes/change-panel.tsx`.
- Performance reads people through `Backend/EY.HRPlatform.Performance/Infrastructure/Core/CoreWorkforceClient.cs` → Core's `internal/corehr/workforce/snapshots` (`WorkforceSnapshot` record in `WorkforceSnapshotContracts.cs`).
- Roles: `Backend/EY.HRPlatform.SharedKernel/Auth/RoleAreas.cs` (`RoleReaches` self/team/everyone, area options mapping reach → `PermissionScopes`; `Holds` ranks DirectReports and OrgUnit alike); `PermissionScopes.OrgUnit` in `CorePermissionCatalog.cs`; Identity `Features/Roles/RoleService.cs`; Core enforcement in `Features/Security/CoreAccessPolicyService.cs` (~40 `DirectReports` branches across Core: reports engine, front page, personal details, org chart, workforce contract service, employees controller) and Performance `Features/Security/PerformanceAccessPolicyService.cs`. `RoleFacts.cs` already resolves a person's unit chain.
- Identity invitations: `Domain/Entities/InviteToken.cs` (CreatedAt/CreatedByUserId, predecessor/replaced-by chain, DeliveryStatus/RecordedAt, AcceptedAt, IsRevoked/RevokedAt, EmployeeId); `ApplicationUser.LastLoginAt`. Core reads account status via `IWorkforceAccountStatusReader` and `PeopleAccessStatus.cs` (`access-status` endpoint).
- Email: `SharedKernel/Notifications/FusionEmailLayout.cs` already renders a `FusionEmailBrand(CompanyName, Color, SentBy, Logo)`; Identity fills it for invitations (`Features/Branding/CompanyBrandReader.cs`, `CanonicalInvitationRenderer.cs`). Core (`Infrastructure/Notifications/CoreNotificationDelivery.cs`) and Performance (`Infrastructure/Notifications/PerformanceNotificationSender.cs`) pass only `companyName` to `FusionNotificationEmail.Render`. Identity already serves `internal/identity/*` endpoints to the modules.

## Session 0 — explorer (no product code)
One interactive artifact, dark 1440×900, Carthage data, recommendation marked:
- On leave: how it's set (Make a change › Leave: type, from, until/open-ended), the person band glance + pill, People list/directory card, org chart card, My team, Home "coming up", Performance person summary/roster; states: scheduled, on leave now, back.
- Access › History: the account timeline on the Access tab (HR view).
- Roles: "Their unit" as a reach in the roles table and role page sentence.
- One branded Core HR notification email next to today's.
User picks; then sessions 1–3 build, each its own commit with the board files.

**Picks (user 2026-11-07, "yup all good proceed": every recommendation in `plans/B-313-explorer.html`):**
- Leave type seen by HR and the manager (and the person); everyone else sees "On leave" and the return day.
- Person band: "On leave" pill by the name (now) and a glance cell with the type/return day (scheduled and now); the photo gets a small leave mark while on leave. Lists, cards, org chart, My team, Performance: mark on the photo + "back <day>" (now), quiet "from <day>" where there's room (scheduled).
- Leave can be open-ended ("Not known yet"); "Until" is the last day off, the return day comes from the work week.
- Leave is a `WorkforceChangeKind` like the others and follows the company's approval rules (HR applies directly; a manager's proposal waits).
- Coming up (person page, the manager's Home) lists the leave; HR gets Change / End early / Cancel. Performance shows it, pauses nothing.
- Access › History newest first, from the invitation chain, deliveries, acceptance and the last sign-in (only the latest is kept; say so). Role grants not included (B-314).
- "Their unit" = the unit the holder works in and every unit under it, updating with the organization; offered on jobs and history, personal details, approving changes, reports, plans and check-ins; Managers keep "their team". The role page's reach menu explains each choice and the preview shows the units and count.
- Branded email exactly like the invitation (logo + name, button in the brand colour, "Sent by <company> with Fusion"); no colour bar.

## Session 1 — B-204 + B-231 (Identity-centred)
- **B-204**: Identity `GET internal/identity/brand/email?tenantId=` → name, colour, logo PNG bytes (reuse `CompanyBrandReader`); a small cached client in SharedKernel (or per module, following the existing internal-client pattern) used by Core and Performance delivery to pass `FusionEmailBrand` into `FusionNotificationEmail.Render` (add the brand parameter there). Fallback to Fusion's look when Identity doesn't answer.
- **B-231**: Identity `GET internal/identity/workforce-access/{employeeId}/history` built from the employee's `InviteToken` chain + delivery attempts + `LastLoginAt` (names of who invited from Identity users); Core endpoint `GET api/corehr/employees/people/{key}/access-history` gated like the Access tab (sign-in area); frontend History section on the Access tab per the drawing.
- Tests: Identity history read (incl. another tenant's employee refused); Core endpoint authorization negative; Core/Perf renderer test that a brand reaches the HTML.

## Session 2 — B-229 On leave
- Domain: `Leave` as a new `WorkforceChangeKind.Leave` with details (leave type value id, from, until?) reusing scheduling, cancel and approvals; or a dedicated `LeavePeriod` entity if the change model can't carry an open end (decide in session from `WorkforceChangeService`). One migration.
- Reads: an `OnLeave { typeLabel, from, until }` on the profile band DTO, People rows/directory, org chart node, My team, Home coming-up, and `WorkforceSnapshot` (so Performance shows it on its person summary/roster without pausing anything).
- Frontend: Make a change › Leave form; pill/glance everywhere drawn; messages en/fr/ar.
- Tests: set/cancel leave; another tenant refused; who can set it (employee manage) negative; snapshot carries it.

## Session 3 — B-212 Their unit (security-sensitive)
- `RoleReaches.Unit` options on job, personal, reports, approve and plans areas mapping to `PermissionScopes.OrgUnit`; `Holds` ranks OrgUnit between team and everyone.
- One reach resolver per service (Core: `ViewerReach` returning the employee set for Self/DirectReports/OrgUnit/Tenant from `RoleFacts`-style unit chains + effective assignments; Performance: via a new snapshot endpoint resolving the viewer's unit subtree) and replace each `DirectReports`-only branch with it.
- Roles UI offers "Their unit"; Access tab reasons say it.
- Tests + API journey: a unit-reach holder sees people in their unit subtree and not outside it, in Core records, reports and Performance plans; cross-tenant negative. Run `security-review`.

## Verification (each session)
- `test-backend.ps1 <Service>` for each service changed (CoreHR, Identity, Performance), full suite once at the end.
- `pnpm --filter core exec vitest run <touched tests>`; type-check/lint via the commit hook; Performance app tests if touched.
- Journeys via `api.cjs` only for B-212 (authz) and B-231's endpoint.
- One screen per new surface (dark, 1440×900) compared with the picked drawing: leave on the person page, Access › History, roles table with unit reach; the email checked in Mailpit.
- Then In review (UI), board + one commit per session.
