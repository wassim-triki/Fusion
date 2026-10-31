---
name: commit-hook-and-message-shape
description: "Fusion's pre-commit hook runs full Frontend lint + type-check (minutes); commit messages need a blank line between subject and bullets."
metadata:
  node_type: memory
  type: reference
  originSessionId: 999a440d-7401-49d2-a342-9e0bef706a9f
  modified: 2026-10-25T16:56:18.708Z
---

- `.husky/pre-commit` runs turbo lint + type-check over the whole working tree, not only the staged files. Since 2026-10-31 (B-234) it covers only our apps and the packages they use (`--filter=shell... core... performance... platform...`); the colleague modules are checked once in B-192. It still takes minutes. Run `git commit` in the background. Claude Code can stop it when system memory is low (2026-10-25); if that happens, nothing is committed and the index stays staged.
- `@repo/ds` lints with `--max-warnings 0`, so a single unused variable blocks the commit.
- Put a blank line between the subject and the bullet lines. Without it, git treats the whole message as the subject (ba8f58af and 0528258c went in that way on 2026-10-25). Related: [[fresh-session-for-applies]].
