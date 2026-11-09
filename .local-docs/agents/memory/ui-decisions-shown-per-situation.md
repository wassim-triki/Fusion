---
name: ui-decisions-shown-per-situation
description: "Interactive scoping of UI decisions shows rendered variants per situation, not explained options; no universal one-size rule across UI domains"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 84031990-a870-4107-b949-a4689ffb391d
  modified: 2026-11-09T21:57:31.583Z
---

When a scope or decision page asks the user to choose UI (colours, empty states, loading, navigation, panels, type), show the variants drawn, in Fusion's real look with real content, and let them speak for themselves: a situation name and at most one line, no paragraphs explaining each option. And never ask for one universal answer across all of Fusion: split each topic into the situations where it occurs (e.g. empty states: a module's first run, an empty section in a record, an empty list, no results after a filter, a chart with no data, not yet / not for your role) and pick per situation; consistency within a situation across modules is the goal.

**Why:** B-390 scope page, 2026-11-09: "You are dumping a lot of text here … I'd rather have the variations instead of them being explained to me. This is an interactive scoping." On F2 (empty states): "I can't just like choose here and feel safe … maybe that's specific to a domain of UI and not all … consistency among these domains is what we want." Also: scoping gets the full Core HR system (research brief, open long list, then ladders), one chapter at a time, each with a session's whole effort.

**Second round, same day (B-397 foundation page, user "not toooo happy"):** thumbnails of today's layouts were "shallow" and judged on "already bad design and layout choices that we're tryinna overhaul anyway"; an obvious pick (load in the page's own shape) got "yeah no shit"; several pairs weren't exclusive ("A and B"); colour options drifted from the theme colours already chosen ("why must the hero and the rest differ"); U6 objected: don't explain disabled buttons more, let validation prevent the problem. So: decide the obvious yourself and only list it; offer combinations where options aren't exclusive; judge visual rules on full-size screens of the target design, not miniatures of current layouts; keep agreed theme colours and refine from them.

**How to apply:** for any decision page, inventory the situations in the code first, draw 2–3 variants per situation, preselect the pick, keep copy to labels. Related: [[scope-with-depth-ladders]], [[ui-no-explanatory-text]], [[decide-surface-architecture-yourself]].
