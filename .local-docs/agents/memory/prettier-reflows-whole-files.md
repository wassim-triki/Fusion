---
name: prettier-reflows-whole-files
description: Frontend .prettierrc says printWidth 80 but existing code is ~120-140 wide; running prettier on an existing file reflows all of it
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9a40f6d8-faf1-4abd-ae77-9e53238449fc
  modified: 2026-10-29T18:36:29.718Z
---

`Frontend/.prettierrc` sets `printWidth: 80`, but the existing code is written at ~120–140 columns and was never formatted to it. Running `prettier --write` on a touched existing file reflows the whole file (B-106: ~1,400 lines of churn across 12 files, reverted).

**Why:** "format only the files you touched" (AGENTS.md) assumes the code already matches the config; here it doesn't, so formatting creates unrelated diffs.

**How to apply:** run prettier only on files you created; for edited existing files, match the surrounding width by hand and check `git diff --stat` before finishing. Lint still runs clean without it. See [[build-speed-mode]].
