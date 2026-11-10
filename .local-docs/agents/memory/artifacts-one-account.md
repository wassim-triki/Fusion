---
name: artifacts-one-account
description: Explorers live in the claude.ai account that published them; a Claude Code login on another account can't read them or their answers. Snapshot answers into the repo.
metadata:
  type: feedback
---

Artifacts (explorers) and their db answers belong to the claude.ai account that published them. On 2026-11-10 a session started signed into a different account: it saw only artifacts up to Nov 7, so the B-412 explorers (style frame, 3b, 3c) and their answers were unreachable until the user ran `/login` with the publishing account. The user: "going forward id like to not have this limitation".

**Why:** a cold session can't record a checkpoint if the answers sit in an account it can't reach; copying isn't possible across accounts and a republished copy starts blank.

**How to apply:**
- At session start, if a STATE row names an explorer, read it first (`Artifact read` or `ArtifactData get`); on "not found", ask the user to `/login` with the account that published it before doing anything else.
- When recording a checkpoint, save the db doc as `plans/B-NNN-<slug>.answers.json` next to the explorer's HTML, so later sessions never depend on the account. Commit it with the board files.
- Publish explorers from the same account every time; the account currently used is the one the user logged into on 2026-11-10.
