---
name: bespoke-ui-beyond-primitives
description: Don't build every surface from bare primitives; specialised moments get crafted UI, and shadcn-based libraries (e.g. ReUI) are fair game. Front pages lead with visual design and a wow factor.
metadata:
  type: feedback
---

B-166 checkpoint 3 (2026-10-30), on the activation page: "spice it up with some subtle design and clean UI, like the one currently used for the password strength … we don't want to just limit ourselves to primitive stuff all over; sometimes it's good to make clean UI for specific stuff, or check existing libraries on top of shadcn like ReUI." On Core HR's front page: "needs to be more friendly, and variants too; always remember the wow factor and visual design first." On the Team page: "lacklustre". On Roles: a restyle of the old layout isn't enough.

**Why:** screens assembled only from cards, rows and segmented controls read flat even when they follow the rules; the user wants specific moments to feel designed.

**How to apply:** for each surface, find its one moment that deserves a crafted component (a strength meter, a chart, a matrix, a timeline) and design it, within DESIGN.md's tokens, radius roles and anti-vibecode rules ([[design-governance-antivibecode]]). Before hand-building, check shadcn-based libraries (ReUI and similar) for a clean fit. For front pages and other taste-heavy screens, offer two or three variants rather than one. Related: [[design-friendly-not-enterprise]], [[vibecode-tells-tinted-hero-cards]].
