---
name: cloud-sessions-partial
description: "Local is the normal flow; Claude Code cloud sessions are an occasional fallback (B-158) on the fork wassim-triki/Fusion, which is now the project home"
metadata:
  node_type: memory
  type: project
  originSessionId: d4650456-462e-48c1-86c7-6700de7ee23e
  modified: 2026-10-29T14:35:14.708Z
---

Decided 2026-10-29 (B-158, plan `.local-docs/agents/plans/B-158-cloud-sessions.md`). Local is the normal flow; a cloud session is an occasional fallback when the PC isn't available, on one Claude account (environments are per account). Cloud VM: ~4 vCPU / 16 GB / 30 GB, Postgres 16 preinstalled, .NET via the setup script (`.agents/skills/fusion-dev/cloud/setup.sh`), nothing keeps running between sessions.

- Repo home is the user's fork `wassim-triki/Fusion` (`origin`, default branch `wassim/develop`); the internship org repo is `upstream`, read-only (the user isn't an org admin and the team is gone after the internship).
- Cloud does code, backend tests, frontend checks; pushes its own branch and opens a PR into `wassim/develop` (user merges). Stack, journeys and screens stay local; `claude --teleport` picks a session up (same account only).
- Switching Claude accounts mid-task is a handoff through the pushed branch and STATE, not a continuation; push before stepping away so the cloud sees the latest work.

**Why:** the user wants work possible away from the PC without making it the main flow, and the org repo has no future after the internship.
**How to apply:** this narrows [[agent-commits-everything]] (cloud sessions push branches and open PRs); never push to `upstream` unless asked; keep [[machine-memory-checks]] for local work.
