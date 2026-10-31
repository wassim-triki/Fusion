---
name: agent-commits-everything
description: "The user never commits; the agent commits all finished work itself, in clean logical commits, and hands over the next session's prompt"
metadata:
  node_type: memory
  type: feedback
  originSessionId: fbe54a56-3f67-4e6e-8ec4-0e132f8baa6d
  modified: 2026-10-26T10:55:47.401Z
---

The user does not commit anything (2026-10-26: "i aint gonna commit nothing btw, all you"). The agent commits every piece of finished work itself, OpenSpec applies included, in one commit per slice, code and board files together (since 2026-10-31, B-234), per `.local-docs/agents/git-conventions/` (no trailers). Push and PRs stay the user's unless asked.

**Why:** the user wants to spend their time on product work, not git chores.

**How to apply:** when work is accepted (or closes on evidence), commit it in the same session. At the end, give the user the exact prompt for the next coding session rather than describing the work. Stop the frontend dev servers before committing, because the pre-commit hook lints and type-checks the whole frontend ([[commit-hook-and-message-shape]]).
