---
name: artifact-db-snapshots-frozen
description: Artifact pages using the db capability must copy snapshot data before keeping it as editable state; frozen objects make clicks silently do nothing.
metadata:
  type: feedback
---

On a published artifact page with the `db` capability, `snap.data()` from `onSnapshot` is deeply frozen. Assigning it straight into the page's state made every later click a silent no-op (non-strict script: writes to frozen objects are ignored), while the save indicator still said "Saved". Hit on the B-163 scope page, 2026-10-30; the user saw a page that stopped responding.

**Why:** the first click worked, its write echoed back as a snapshot, and from then on state was frozen.

**How to apply:** in any artifact page that mirrors a db doc into local state, clone first (`JSON.parse(JSON.stringify(snap.data()))` or `structuredClone`). Also skip snapshots while local edits are unsaved, and keep one write at a time per doc. Applies to the B-166 explorer and any later decision pages ([[scope-with-depth-ladders]], [[decide-surface-architecture-yourself]]).
