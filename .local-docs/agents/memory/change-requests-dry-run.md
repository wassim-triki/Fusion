---
name: change-requests-dry-run
description: B-179 change requests validate by staging in a rolled-back transaction; it clears the EF tracker, and profile hooks must sit above early returns
metadata:
  type: project
---

Change requests (B-179, `Features/People/Changes/ChangeRequests.cs`) are checked by staging the real change in a transaction that is rolled back, then `ChangeTracker.Clear()`. Anything only added to the context before proposing is lost (tests must save catalogue rows first, see `SavedJob`), and entities loaded before must be re-read. Approval re-stages for real only while the person's basis fingerprint (assignment, line, employment, latest coming change) still matches.

**Why:** one set of rules for asking and applying; a stale draft is refused, not applied over newer facts.

**How to apply:** when adding a change kind, stage it through `WorkforceChangeService` and let `ProposeAsync` dry-run it; never hand-write rows for a request. In `people-profile-workspace.tsx`, new hooks go above the `profile.isLoading` early return (a hook below it crashed the page for managers; tests didn't catch it because they never render the loading state). Related: [[roles-model]].
