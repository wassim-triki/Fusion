# STATE - live handoff

**Last finished:** B-292 batch 3, 2026-11-05: B-272 closed ○ (scale test 3/3 alone, full CoreHR 471/0/0; the runner now keeps failure detail), B-279 closed ○ (401 revision-stale after publication; the journey refreshes like the browser, 3/3). B-292 closed; B-291 In review on its own.

## Active work

None.

## Next

B-191 single sign-on, fresh session at **xhigh**. Cold pickup: read `plans/B-191-single-sign-on.md` (decisions 1–8, pieces, proof, order), then `AuthController` (login/refresh), `IAuthSessionFactory`, the three acceptance paths (`InvitesController` accept → workforce acceptance service, `AdministratorInvitationAcceptanceController`, `TenantActivationController`), Core `features/settings/sections/sign-in.tsx`, shell `app/auth/signin`. No real provider credentials needed; the Development-only test provider covers everything.
