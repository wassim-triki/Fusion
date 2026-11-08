---
name: administrators-page-redesign
description: "Historical (2026-09): the old /core/access Administrators workspace. Superseded by Settings › Roles › Administrators (B-178); /access, admin invitations and suspend/reactivate removed in B-326"
metadata: 
  node_type: memory
  type: project
  originSessionId: 29d13547-63fc-43ba-a96a-71378d01d0fe
  modified: 2026-09-12T19:26:47.543Z
---

**Superseded.** B-178 moved Administrators to Settings › Roles › Administrators (make/remove only, two-administrator rule). B-326 (2026-11-08) removed the `/access` routes, the `TenantAdministrator` invitation purpose (only platform recovery invites administrators now) and administrator suspend/reactivate. What follows is history; "Added by" provenance still drives the page.

`/core/access` (the Tenant **Administrators** surface, see [[workforce-access-activation]] for the rename) fully redesigned 2026-09-12 from a single combined list into a **tabbed master-detail**, faithful to a user-supplied design reference. Uncommitted.

Layout: PageHeader (eyebrow "Tenant administration" amber, serif title, "View activity log →" link) → `ContinuityBanner` (posture dot+label from CONTINUITY_*, advisory only when At risk/RecoveryRequired, Active/Pending/Suspended stat columns, Invite button) → 2-col grid at `xl` (left = DS `Tabs` line-variant *Administrators / Invitations / Removed* + search + tables; right = persistent `AdministratorDetail` panel or a "No administrator selected" placeholder). Below `xl` the detail opens as a `Sheet` (gated by a local `useIsWide` matchMedia hook). Theme-aware (reference was dark; renders correct in both).

New files under `Frontend/apps/core/src/features/tenant-access/components/`: `continuity-banner.tsx`, `access-tables.tsx` (AdministratorsTab/AdministratorTable/InvitationsTable/RemovedTable/EmptyStateCard + ChangeEmailDialog), `administrator-detail.tsx`, `activity-log-workspace.tsx`. Rewrote `access-workspace.tsx`. **Deleted** old `administrator-panel.tsx` + `invitation-row.tsx`. New route `app/(pages)/access/activity/page.tsx` → activity-log workspace (keyset-paged feed via existing `tenantAccessPaths.activity()`, Load-more).

**Backend additions** (read-only, no migration): `TenantAdministratorListItem.AddedBy` provenance (BootstrapActivation→"System (tenant activation)", PlatformRecovery→"Platform recovery", InvitationAcceptance→inviter name/"Invitation accepted", TenantAdministrator→grantor name) resolved in `TenantAccessProjection.GetAdministratorsAsync`; new `GetRemovedAdministratorsAsync` (memberships with a revoked assignment and no active one; latest revocation per membership; "Removed themselves" when self) + `RemovedAdministratorListItem`; new `GET api/identity/tenant-access/administrators/removed`. `@repo/api`: `TenantAdministratorDto.addedBy`, `RemovedAdministratorDto`, `removedAdministrators` path+key; hook `useRemovedAdministrators`.

**Conflict resolutions (deliberate deviations from the mock):**
- Invitations have no confirmed name → collapsed mock's Name+Email into one truthful **Recipient** column (dashed-envelope mark, email as identity).
- Mock showed "Remove yourself" enabled for the sole admin; instead **all destructive/suspend actions disable with the `blockedReason`** when the person is the only usable administrator (backend would refuse anyway) — honest state over the mock pixel. Self-view: Suspend + Remove-authority always disabled; "Remove yourself" is the self path.
- All administrator mutations route through the detail panel (one action surface); admin row ⋯ = Manage access / Copy email. Invitation ⋯ keeps Resend/Change-email/Revoke.

Iterations after initial build (all uncommitted): invite dialog now collects First/Last name + email (threads through `CreateAdministrative`→acceptance prefill, mirrors platform bootstrap); on-load auto-selects the logged-in admin's own record (wide only, once); unified skeleton (shell `AccessPageSkeleton`/`ActivityLogPageSkeleton` reused by the page's own initial-load gate — no two-stage flash); tabs dropped then re-added as a 2-way **Administrators / Removed** switch (Active→Pending→Suspended stacked in default; Removed its own tab); compact single-row empty states (`bg-muted/20` dashed); removed the "another active administrator is required" sentence (+ its Invite button, + unused `onInviteAnother`) — sole-admin actions just disable silently.

**E2E action audit 2026-09-12 (tenant10, Playwright + Mailpit + Gateway accept):** all 10 actions pass — invite, resend, change-email, revoke, invite→accept (real 2nd admin via Mailpit credential→`POST …/invitations/accept`), open/details, **recent admin-access activity in panel** (had been dropped in redesign — RE-ADDED via `useRecentAccessActivity` filtered by `resourceId===membershipId`), suspend, reactivate, remove-authority→Removed tab, remove-yourself enabled when not last. **Guardrail confirmed**: sole usable admin → Suspend/Remove-authority/Remove-yourself all disabled; continuity flips Secure↔At risk with usable count. Activity log shows accepted/suspended/removed events. "Added by" resolves to inviter (e.g. "First Admin") for invited admins, "System (tenant activation)" for bootstrap.

Verified: Identity rebuilt+restarted (no schema change); api/auth/core type-check + core lint clean; rendered via repo Playwright signed in as tenant10 `admin@tenant10.com` / **`Admin@123456`** (the the local password (`FUSION_LOCAL_PASSWORD`) pw in [[local-dev-auth]] is now stale for tenant10) — light+dark match reference, detail panel, Removed tab, activity log, narrow 400px all good.
