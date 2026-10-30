---
name: roles-model
description: "B-177 roles model (D-25) as built — areas over access profiles, holders by rule, recompute, linked Jobs/Personal, gotchas"
metadata:
  node_type: memory
  type: project
  originSessionId: b4e9d669-d65d-499f-a8f6-9232da5c4cf8
  modified: 2026-10-30T22:41:31.269Z
---

Roles (B-177, built 2026-10-30, In review) sit on access profiles and grants; SharedKernel `RoleAreas` maps ten areas (level × reach) onto catalogue keys with defining + companion grants. A role's cell = strongest option whose defining keys it holds; saving writes cells and keeps keys no area owns. Brand and Roles areas are Administrators only (stripped from every other role at start-up).

Holders: `AccessProfiles.HolderKind` (chosen/everyone/team/rule) + `AccessProfileRuleConditions`; `UserAccessProfiles.IsChosen`/`ByRule`, row kept while either holds. Identity recomputes from Core HR's signed `internal/corehr/role-facts` (Core HR's EF interceptor signals after any assignment/reporting/employment/unit save; worker sweeps every 6 h).

**Why:** the user asked for "a complete refurbish, design and systematic functionality" (D-25), with roles that fill themselves.

**How to apply:** chosen people are account (user) ids, not employee ids — an account without a person record can hold a role. Jobs and Personal details share keys for team/everyone until B-214 splits them; "their unit" reach waits on B-212. The Tenant Administrator definition grants only via the canonical assignment (an invitation naming it is refused). Related: [[perf-first-principles-rework]], [[permission-gate-hide-not-deny]].
