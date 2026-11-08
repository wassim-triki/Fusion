# B-326 Cleanup batch

User 2026-11-08: "are we ready to batch them together in 1 session of work cleanly?" → "yup do it". One session, one commit, closes on evidence (no screens: nothing new to look at).

| Item | What |
|---|---|
| B-324 | Dead code the rebuilds left behind (children below) |
| B-299 | Administrator Suspend/Reactivate and the `TenantAdministrator` invitation purpose |
| B-222 | Core HR's leftovers of the old Administrators workspace |
| B-194 | The legacy employee write endpoints and their commands |
| B-300 | "Tenant Administrator" → "Administrator" in backend role names, mail and audit |
| B-221 | Administrator invitations from before B-178: settled by removing the purpose, or listed/expired if recovery keeps it |
| B-311 | One definition per rule within each side |

## Order
1. **Reachability first (B-299, B-221).** `PlatformAdministratorRecoveryService`, `TenantAccessProjection`, `TenantContinuityHealthProjection` and `AdministrativeInvitationAcceptanceService` still read `InvitationPurpose.TenantAdministrator` (plus `InviteTokenConfiguration`'s check constraint). Trace whether platform recovery (Platform › tenant record) still issues or accepts that purpose. If nothing in the product reaches it: delete the purpose, suspend/reactivate, their acceptance branch and tests; a schema-only migration drops the purpose from the check constraint (no data carried across; unaccepted rows of that purpose are deleted by the migration or refused: pick the one the constraint allows). If recovery uses it: keep it, write in B-299 why, and do B-221 as "pending pre-B-178 administrator invitations expire" instead.
2. **B-194.** `EmployeesController`: `POST /employees` (570), `PUT /employees/{id}` (755), `terminate` (810), `rehire` (850), `change-manager` (900), their commands/handlers and tests. First grep Frontend (all apps, colleague modules included) and the gateway for callers; none expected.
3. **B-222.** Core HR app: the `admins` message namespace (en/fr/ar), the `/access` route skeletons, the invite acceptance's Employee/Manager label from `InviteToken.Role`; suspend/reactivate leftovers with step 1.
4. **B-300.** Identity strings saying "Tenant Administrator": `TenantAdministratorAuthority.DisplayName` (SharedKernel), `TenantAdministratorAssignment`, `TenantAdministratorGrantDeltaReport`, `AdministrativeInvitationAcceptanceService`, `TenantAdministratorLifecycleService`. Words only; type names stay. Frontend readers of `actorRole` / "Tenant Administrator" adjusted (Change history's actor role, if shown).
5. **B-311.** Backend: one password policy (`AccountPasswordPolicy`) already; check nothing else restates its numbers. Frontend: the rule lives in one place (the DS `password-strength-field` or a small `@repo/auth` module) and these read it: `apps/shell/src/lib/activation.ts`, `apps/shell/src/app/activate-invitation/activate-invitation.tsx`, `apps/core/src/app/invite/accept/invite-acceptance-form.tsx`, `apps/core/src/features/settings/sso/single-sign-on.tsx`, `packages/auth/src/components/password-reset-page.tsx`. Then a short sweep for other rules repeated within one side (email/address checks, name/length limits, colour format, file size limits): fix the small ones, board the rest under B-311's successor. Colleague modules (Learning, Recruitment, Interview, Onboarding) are out of scope.

## Checks
- Full Identity and CoreHR suites (`test-backend.ps1`), the migration up through the relational suite.
- Touched frontend tests (shell activation, core invite acceptance and SSO, auth reset page, DS password field); type-check via the hook.
- Journey only if an authorization path changed (removing endpoints doesn't need one; recovery changes would).
- Close each item ○ with its evidence; no In review.
