---
name: review-handoff-screens-or-credentials
description: "When asking the user to look at something, send the screenshots inline or give the exact sign-in (email + password) with each localhost link"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 41ecc8b7-8fde-4acb-9883-39b2c9919b3e
  modified: 2026-11-04T19:43:13.713Z
---

When handing work over for the user's look, either send the screenshots directly (SendUserFile) or, with each localhost link, give the account email and password to sign in with. Never just a link plus "as Amira".

**Why:** user 2026-11-04: "if you want me to review it, either take a screenshot of it or if you're gonna send me the localhost link, link me credentials I could use too please".

**How to apply:** default to sending the screens inline; when a live check matters, list each account's email and the local password in the chat reply (the password comes from the `FUSION_LOCAL_PASSWORD` user variable; never write it into tracked files). Related: [[name-people-with-roles]].
