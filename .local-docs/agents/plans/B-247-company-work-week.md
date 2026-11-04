# B-247 — Company work week

In review. **2026-11-04 redesign (user picked option C of the [Home cards canvas](https://claude.ai/artifact/BvgCaYiseSdKQ31Vzj5bPp)):** the company card and People card are now one card: the logo large and centred, the name, one line (language · time zone · work week), the newest four faces with the count (the row opens People), Edit your company at the foot. [Live screen](B-247-screens/02-home-company.png), dark 1440×900, the Fresh preset's administrator.

Settings › Details' selector is accepted; B-278 closed 2026-11-03 (“good, can be closed”). Seven whole-day chips, common-week menu, working-day/day-off summary, staged Save changes/Discard and final-day protection. Evidence in [LOG](../LOG.md); its review plan/screens are preserved in local `archive/plans/`. No further Settings review remains under B-247; the Home company card below remains In review.

Open [Home](http://localhost:3000/) as the existing Fresh preset’s administrator (`amira.khelifi@fresh-5.example.test`), whose setup guide is still visible. Its company card shows language, time zone and the saved work week as label-over-value facts, following D-09. A split week lists its days; a consecutive week shows a range. Screenshot: [Details](B-247-screens/01-settings-details.png), [Home company card](B-247-screens/02-home-company.png), dark 1440×900.

Core HR owns the work week in the existing tenant-settings JSON. Default Monday–Friday; ISO days 1–7, a nonempty distinct set. Existing organization save permission, If-Match concurrency, settings audit and unrelated overrides are retained. Home reads only workingDays via `/api/corehr/settings/work-week`; no Identity copy or migration.
