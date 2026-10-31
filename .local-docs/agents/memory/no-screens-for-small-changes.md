---
name: no-screens-for-small-changes
description: Don't take screenshots for trivial or minor changes; screens only for real UI slices or when asked
metadata:
  type: feedback
---

Don't take screenshots for trivial or minor changes (a spacing fix, a style rule swept across components, a copy tweak). Screens are for a slice's taste review or when the user asks.

**Why:** user, 2026-10-31: "Stop taking unnecessary screenshot please, especially for trivial things or minor stuff" (after screens of a quote-style sweep).

**How to apply:** for small follow-ups, verify with type-check and tests, describe the change, commit. Related: [[rendered-verification-playwright]], [[minimize-eta-no-fluff]].
