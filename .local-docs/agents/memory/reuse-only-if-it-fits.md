---
name: reuse-only-if-it-fits
description: Don't reuse an existing UI pattern just because it exists; reuse it only when it matches the design direction
metadata:
  type: feedback
---

Don't use an existing component or pattern just because it's already there. Check whether it fits the design we're going for (DESIGN.md, the accepted B-166 decisions); reuse it if it does, otherwise build the right thing.

**Why:** in B-175 the Organization view switch (Structure · Jobs · Places) was the old lens strip turned into links, and the hire form kept its old layout. The user called the hire form very bad and asked for the tabs to match the target design: "Don't use stuff just because it exists. This is an ongoing rule." (2026-10-30)

**How to apply:** when a screen in a slice touches older UI (tabs, forms, headers), judge it against the accepted grammar before keeping it. If it doesn't fit and redoing it is out of the slice's scope, put it on the board rather than ship it silently. Related: [[rewrites-acceptable]], [[design-friendly-not-enterprise]], DESIGN.md principle 13.
