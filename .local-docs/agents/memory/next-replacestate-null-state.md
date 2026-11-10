---
name: next-replacestate-null-state
description: Next 15 App Router ignores history.replaceState calls whose state carries its own __NA marker; pass null to update useSearchParams
metadata:
  type: project
---

`window.history.replaceState(window.history.state, "", url)` does not update `useSearchParams`/`usePathname` in Next 15.5: the state already holds Next's `__NA` marker, so Next's patched `replaceState` treats it as its own internal call and skips syncing. The URL changes, React state doesn't (B-419: the Organization slider stayed on today while the address moved). Pass `null` as the state when the page reads the change back; Next copies its internal state in itself. Calls that only strip a param and don't read it back (change sheet, SSO return) are fine either way.

**Why:** B-399 shipped the `window.history.state` form and the slider silently stopped following the hand.
**How to apply:** any client-side URL write meant to re-render through `useSearchParams` uses `replaceState(null, "", url)` / `pushState(null, …)`. Related: [[next-bundled-react-no-useeffectevent]].
