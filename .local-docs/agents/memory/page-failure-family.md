---
name: page-failure-family
description: B-302 failure pages - PageFailure in @repo/auth picks the state, PageState in @repo/ds draws it; server files must not pull client hooks into page-states.tsx
metadata:
  type: project
---

Failure UI lives in two places: `PageState` and drawings in `@repo/ds/shell`, `PageFailure`/`PageRefusal`/`PageGone`/`PageNotFound` in `@repo/auth` (DS can't depend on `@repo/api`). New sites pass the query's `error` and `refetch`; a record's page also passes `back`. Empty states stay on `PageEmpty`.

**Gotchas:** `page-states.tsx` is imported by server `loading.tsx` files through the barrel, so a hook there breaks cold builds while type-check and dev pass; client bits go in their own `"use client"` file. Refetching a query with no data flips status to pending, so outage retries probe `serviceAnswers` first. `CommandDialog` needs its own `Command` child. Screens: set `localStorage.theme = "dark"`, and never wait on `networkidle` (the notification stream never settles).

Related: [[loading-architecture]], [[ds-spinner-animation]].
