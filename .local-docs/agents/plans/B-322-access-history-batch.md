# B-322 Access and history batch

User 2026-11-08: "220, 314, 203 batch em together".

| Item | What | Taste | Session |
|---|---|---|---|
| B-314 | Person › Access › History tells role grants: given by whom and when, held by a rule, removed. | Rows in the accepted History list | 1 |
| B-203 | A Brand save shows in Settings › Change history (name, colour, language, logo, welcome line). | Rows in the accepted Change history | 1 |
| B-220 | While seeing Fusion as someone, changes are inert (greyed, with the reason) instead of failing on the server. | The B-178 drawing's greyed "Propose a change" | 2 |

No explorer: each piece extends a surface that is already accepted.

## How it works today (2026-11-08)
- Identity keeps `AccessAuditEvent` (tenant, actor, action, resource, before/after JSON). `AccessAuditService.RecordAsync` is called only for role definition saves (`access.profile.created|updated|deleted` in `CoreAccessController`). Settings › Change history (`change-history.tsx`) merges Core HR's settings audit (`/corehr/settings/governance/audit`) with Identity's (`/identity/core-access/audit`) on the page.
- Role holders live in `UserAccessProfiles` (`IsChosen`, `ByRule`); a row is deleted when neither holds. Writers: `RoleService`, `RoleHolders` (rule recompute from Core HR's role facts), `AccessProfileService`, `WorkforceBaselineService`. Nothing records a person gaining or losing a role.
- Person › Access › History (B-231): Identity `GET internal/identity/workforce-accounts/{employeeId}/history` (invitations, resend/withdraw actors, last sign-in) → Core `GET api/corehr/workforce/access-subjects/{employeeId}/history`.
- Brand: `BrandController.Save` writes nothing to any audit; `SettingsSectionRegistry` notes "its changes aren't in Core's history".
- View-as: every write is refused server-side (403 "Nothing can be changed while seeing Fusion as someone"); `@repo/auth` has `useViewAs`.

## Session 1: B-314 + B-203 (Identity, Core HR, core app)
- One place records holder changes: where `UserAccessProfiles` rows are added, removed or change why they hold (chosen ↔ rule), write an `AccessAuditEvent` per person (`access.grant.given` / `access.grant.removed`, resource = the account id, after = role id + name + how: chosen or rule). Actor = the person who saved for chosen holders; none for rule recomputes ("by rule").
- The person's history endpoint adds these rows: "Given the Managers role by Amira Khelifi", "Holds Managers by rule", "Managers removed" (by whom, or "no longer matches the rule"). Words en/fr/ar.
- Brand: `Save` records `brand.saved` with before/after (name, colour, language, logo changed, welcome line); Change history lists it under Brand with the changed values; the registry's note goes.
- Tests: Identity (grant given/removed by chosen and by rule are recorded; another tenant's history doesn't show them; brand save recorded, a refused save isn't), Core history mapping; core app history rendering. Journey only if a read endpoint's authorization changes (it shouldn't).
- Screens: 01 Person › Access › History with grant rows; 02 Change history with a Brand entry.

## Session 2: B-220 (shell, core, performance)
- `@repo/auth` exposes whether the session is seeing Fusion as someone (from `useViewAs`). Write actions read it: the button stays, disabled, with "You're seeing Fusion as {name}" on hover/focus; forms open read-only. Sweep the write entry points of our apps (people changes, settings saves, Performance plan/check-in/feedback/review writes, Home actions); the server's refusal stays as the guard.
- Tests: a component per app shows the inert action while viewing; type-check via the hook.
- Screen: 03 a person page while seeing Fusion as someone, "Propose a change" greyed.
